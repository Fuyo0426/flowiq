"""
FlowIQ — 十年歷史資料回填爬蟲
────────────────────────────────
功能：
  • 爬取 TWSE（上市）+ TPEX（上櫃）歷史籌碼資料
  • 斷點續傳：每天完成後寫 scrape_progress.json，重跑自動跳過已完成日期
  • TWSE / TPEX 兩路並行（ThreadPoolExecutor），每天約 6 秒
  • 直寫 Railway PostgreSQL（設定 DATABASE_URL 環境變數）

使用方式：
  1. 複製 Railway PostgreSQL 連線字串到環境變數：
       Windows: set DATABASE_URL=postgresql://...
       Mac/Linux: export DATABASE_URL=postgresql://...
  2. 執行：
       python backend/scrapers/backfill_10y.py
     或指定日期範圍（YYYYMMDD）：
       python backend/scrapers/backfill_10y.py --start 20200101 --end 20231231

注意：
  • 融資融券（MI_MARGN）僅限當日，歷史資料設為 0
  • TWSE T86 + STOCK_DAY_ALL 支援歷史日期查詢
  • TPEX 三大法人 + 收盤價 + 融資融券 均支援歷史日期查詢
  • 非交易日（週末 / 假日）API 回傳空資料，自動跳過
  • 建議 DELAY=2 秒，避免被 TWSE/TPEX 擋 IP

預估時間（預設 2015-01-01 起）：
  約 2,500 交易日 × 6s ≈ 4.2 小時
"""

import sys, os, json, ssl, time, logging, argparse
import psycopg2, psycopg2.extras
from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ── 路徑設定 ─────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE.parent))

import urllib.request

# ── 環境檢查 ─────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print('[ERROR] 請先設定 DATABASE_URL 環境變數')
    print('  Windows: set DATABASE_URL=postgresql://user:pass@host/dbname')
    print('  Mac/Linux: export DATABASE_URL=postgresql://...')
    sys.exit(1)

# ── 日誌 ─────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_HERE / 'backfill.log', encoding='utf-8'),
    ]
)
log = logging.getLogger('backfill')

# ── 設定 ─────────────────────────────────────────────────────────────────────
DELAY = 2          # 每次 API 請求間隔（秒）
PROGRESS_FILE = _HERE / 'scrape_progress.json'
DEFAULT_START = '20150101'

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}


# ── 通用工具 ─────────────────────────────────────────────────────────────────
def _fetch_json(url: str) -> dict | list:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


def _fetch_big5(url: str) -> dict | list:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
        raw = r.read()
    try:
        return json.loads(raw.decode('big5', errors='replace'))
    except json.JSONDecodeError:
        return json.loads(raw.decode('utf-8', errors='replace'))


def _int(s) -> int:
    try:
        return int(str(s).replace(',', '').strip())
    except Exception:
        return 0


def _float(s) -> float | None:
    try:
        v = float(str(s).replace(',', '').strip())
        return v if v > 0 else None
    except Exception:
        return None


def western_to_roc(trade_date: str) -> str:
    """20260313 -> 115/03/13"""
    y = int(trade_date[:4]) - 1911
    return f'{y}/{trade_date[4:6]}/{trade_date[6:8]}'


# ── TWSE 資料擷取 ─────────────────────────────────────────────────────────────
def twse_institutional(trade_date: str) -> dict:
    """T86：三大法人買賣超（支援歷史日期）"""
    url = f'https://www.twse.com.tw/fund/T86?response=json&date={trade_date}&selectType=ALL'
    try:
        data = _fetch_json(url)
    except Exception as e:
        log.warning(f'[TWSE 三大法人] {trade_date} 失敗: {e}')
        return {}

    if data.get('stat') != 'OK':
        return {}

    result = {}
    for row in data.get('data', []):
        sid = str(row[0]).strip()
        result[sid] = {
            'foreign_buy':  _int(row[2]),
            'foreign_sell': _int(row[3]),
            'foreign_net':  _int(row[4]),
            'trust_buy':    _int(row[8]),
            'trust_sell':   _int(row[9]),
            'trust_net':    _int(row[10]),
            'dealer_net':   _int(row[11]),
            'inst_net':     _int(row[18]),
        }
    log.info(f'  [TWSE 三大法人] {trade_date}: {len(result)} 支')
    return result


def twse_price(trade_date: str) -> dict:
    """STOCK_DAY_ALL：全市場收盤價（支援歷史日期）"""
    url = f'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date={trade_date}'
    try:
        data = _fetch_json(url)
    except Exception as e:
        log.warning(f'[TWSE 收盤價] {trade_date} 失敗: {e}')
        return {}

    if data.get('stat') != 'OK':
        return {}

    result = {}
    for row in data.get('data', []):
        sid = str(row[0]).strip()
        p = _float(row[7])  # 收盤價
        if p:
            result[sid] = p
    log.info(f'  [TWSE 收盤價] {trade_date}: {len(result)} 支')
    return result


def fetch_twse_day(trade_date: str) -> tuple[dict, dict]:
    """並行 worker：擷取 TWSE 三大法人 + 收盤價"""
    inst = twse_institutional(trade_date)
    time.sleep(DELAY)
    price = twse_price(trade_date)
    return inst, price


# ── TPEX 資料擷取 ─────────────────────────────────────────────────────────────
def tpex_institutional(trade_date: str) -> dict:
    """TPEX 三大法人買賣超（支援歷史日期）"""
    roc = western_to_roc(trade_date).replace('/', '%2F')
    url = (
        f'https://www.tpex.org.tw/web/stock/3insti/daily_trade/'
        f'3itrade_hedge_result.php?l=zh-tw&t=D&d={roc}&response=json'
    )
    try:
        data = _fetch_big5(url)
    except Exception as e:
        log.warning(f'[TPEX 三大法人] {trade_date} 失敗: {e}')
        return {}

    result = {}
    for table in data.get('tables', []):
        for row in table.get('data', []):
            if not isinstance(row, list) or len(row) < 24:
                continue
            sid = str(row[0]).strip()
            if not sid:
                continue
            try:
                result[sid] = {
                    'foreign_buy':  _int(row[8]),
                    'foreign_sell': _int(row[9]),
                    'foreign_net':  _int(row[10]),
                    'trust_buy':    _int(row[11]),
                    'trust_sell':   _int(row[12]),
                    'trust_net':    _int(row[13]),
                    'dealer_net':   _int(row[22]),
                    'inst_net':     _int(row[23]),
                }
            except (IndexError, Exception):
                continue
    log.info(f'  [TPEX 三大法人] {trade_date}: {len(result)} 支')
    return result


def tpex_price(trade_date: str) -> dict:
    """TPEX dailyQuotes：上櫃收盤價（支援歷史日期）"""
    roc = western_to_roc(trade_date)
    url = f'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?d={roc}&response=json'
    try:
        data = _fetch_json(url)
    except Exception as e:
        log.warning(f'[TPEX 收盤價] {trade_date} 失敗: {e}')
        return {}

    result = {}
    for table in data.get('tables', []):
        for row in table.get('data', []):
            if not isinstance(row, list) or len(row) < 3:
                continue
            sid = str(row[0]).strip()
            p = _float(row[2])
            if sid and p:
                result[sid] = p
    log.info(f'  [TPEX 收盤價] {trade_date}: {len(result)} 支')
    return result


def tpex_margin(trade_date: str) -> dict:
    """TPEX 融資融券（支援歷史日期）"""
    roc = western_to_roc(trade_date)
    url = f'https://www.tpex.org.tw/www/zh-tw/margin/balance?d={roc}&response=json'
    try:
        data = _fetch_json(url)
    except Exception as e:
        log.warning(f'[TPEX 融資融券] {trade_date} 失敗: {e}')
        return {}

    result = {}
    for table in data.get('tables', []):
        fields = table.get('fields', [])
        try:
            margin_idx = fields.index('資餘額')
            short_idx = fields.index('券餘額')
        except ValueError:
            continue
        for row in table.get('data', []):
            if not isinstance(row, list) or len(row) <= max(margin_idx, short_idx):
                continue
            sid = str(row[0]).strip()
            if sid:
                result[sid] = {
                    'margin_balance': _int(row[margin_idx]),
                    'short_balance':  _int(row[short_idx]),
                }
    log.info(f'  [TPEX 融資融券] {trade_date}: {len(result)} 支')
    return result


def fetch_tpex_day(trade_date: str) -> tuple[dict, dict, dict]:
    """並行 worker：擷取 TPEX 三大法人 + 收盤價 + 融資融券"""
    inst = tpex_institutional(trade_date)
    time.sleep(DELAY)
    price = tpex_price(trade_date)
    time.sleep(DELAY)
    margin = tpex_margin(trade_date)
    return inst, price, margin


# ── 資料庫寫入 ────────────────────────────────────────────────────────────────
_INSERT_SQL = """
    INSERT INTO chip_daily
        (date, stock_id,
         foreign_buy, foreign_sell, foreign_net,
         trust_buy, trust_sell, trust_net,
         dealer_net, inst_net,
         margin_balance, short_balance, close_price)
    VALUES %s
    ON CONFLICT (date, stock_id) DO NOTHING
"""

def write_to_db(trade_date: str, twse_data: tuple, tpex_data: tuple) -> int:
    """
    合併 TWSE + TPEX 資料寫入資料庫
    使用 psycopg2 execute_values 批次寫入，速度比逐筆快100倍
    """
    twse_inst, twse_price_d = twse_data
    tpex_inst, tpex_price_d, tpex_margin_d = tpex_data

    # 若當天完全無資料，代表是非交易日，跳過
    if not twse_inst and not twse_price_d and not tpex_inst and not tpex_price_d:
        log.info(f'  {trade_date} 無資料（非交易日），跳過')
        return -1

    dt = trade_date[:4] + '-' + trade_date[4:6] + '-' + trade_date[6:8]  # YYYY-MM-DD

    rows = []

    # TWSE rows
    for sid in set(twse_inst.keys()) | set(twse_price_d.keys()):
        d = twse_inst.get(sid, {})
        rows.append((
            dt, sid,
            d.get('foreign_buy', 0), d.get('foreign_sell', 0), d.get('foreign_net', 0),
            d.get('trust_buy', 0), d.get('trust_sell', 0), d.get('trust_net', 0),
            d.get('dealer_net', 0), d.get('inst_net', 0),
            0, 0,  # margin/short 歷史無資料
            twse_price_d.get(sid),
        ))

    # TPEX rows
    for sid in set(tpex_inst.keys()) | set(tpex_price_d.keys()):
        d = tpex_inst.get(sid, {})
        mg = tpex_margin_d.get(sid, {})
        rows.append((
            dt, sid,
            d.get('foreign_buy', 0), d.get('foreign_sell', 0), d.get('foreign_net', 0),
            d.get('trust_buy', 0), d.get('trust_sell', 0), d.get('trust_net', 0),
            d.get('dealer_net', 0), d.get('inst_net', 0),
            mg.get('margin_balance', 0), mg.get('short_balance', 0),
            tpex_price_d.get(sid),
        ))

    if not rows:
        return 0

    try:
        pg = psycopg2.connect(
            DATABASE_URL,
            keepalives=1, keepalives_idle=30,
            keepalives_interval=10, keepalives_count=5,
        )
        pg.autocommit = False
        cur = pg.cursor()
        psycopg2.extras.execute_values(cur, _INSERT_SQL, rows, page_size=2000)
        count = cur.rowcount
        pg.commit()
        cur.close()
        pg.close()
        log.info(f'  {trade_date} 寫入完成：{len(rows)} 支，新增 {count} 筆')
        return count
    except Exception as e:
        log.error(f'  {trade_date} 寫入失敗: {e}')
        return 0


# ── 斷點續傳 ──────────────────────────────────────────────────────────────────
def load_progress() -> set[str]:
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text(encoding='utf-8'))
        return set(data.get('completed', []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.write_text(
        json.dumps({'completed': sorted(completed)}, indent=2),
        encoding='utf-8'
    )


# ── 交易日生成 ────────────────────────────────────────────────────────────────
def gen_weekdays(start: str, end: str) -> list[str]:
    """生成 start~end 之間所有平日（週一到週五）"""
    s = datetime.strptime(start, '%Y%m%d').date()
    e = datetime.strptime(end, '%Y%m%d').date()
    days = []
    cur = s
    while cur <= e:
        if cur.weekday() < 5:  # 0=Mon, 4=Fri
            days.append(cur.strftime('%Y%m%d'))
        cur += timedelta(days=1)
    return days


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='FlowIQ 十年歷史資料回填')
    parser.add_argument('--start', default=DEFAULT_START, help='起始日期 YYYYMMDD（預設 20150101）')
    parser.add_argument('--end', default=date.today().strftime('%Y%m%d'), help='結束日期 YYYYMMDD（預設今天）')
    parser.add_argument('--reset', action='store_true', help='清除斷點紀錄，重新爬取全部')
    args = parser.parse_args()

    if args.reset and PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        log.info('[斷點] 已清除，從頭開始')

    completed = load_progress()
    all_days = gen_weekdays(args.start, args.end)
    pending = [d for d in all_days if d not in completed]

    log.info(f'[初始化] 日期範圍：{args.start} ~ {args.end}')
    log.info(f'[初始化] 總平日：{len(all_days)} | 已完成：{len(completed)} | 待爬取：{len(pending)}')
    log.info(f'[初始化] 目標資料庫：{DATABASE_URL[:40]}...')
    log.info(f'[初始化] 預估時間：{len(pending) * 6 / 3600:.1f} 小時')

    if not pending:
        log.info('[完成] 所有日期已爬取完畢')
        return

    total_written = 0
    error_days = []

    for i, trade_date in enumerate(pending, 1):
        log.info(f'[{i}/{len(pending)}] 處理 {trade_date}')

        try:
            # TWSE 和 TPEX 並行爬取
            with ThreadPoolExecutor(max_workers=2) as executor:
                twse_future = executor.submit(fetch_twse_day, trade_date)
                tpex_future = executor.submit(fetch_tpex_day, trade_date)
                twse_data = twse_future.result(timeout=120)
                tpex_data = tpex_future.result(timeout=120)

            # 寫入資料庫
            n = write_to_db(trade_date, twse_data, tpex_data)

            # 標記完成（包含非交易日 n=-1）
            completed.add(trade_date)
            save_progress(completed)

            if n >= 0:
                total_written += n

            # 每 50 天輸出進度摘要
            if i % 50 == 0:
                pct = i / len(pending) * 100
                remaining_h = (len(pending) - i) * 6 / 3600
                log.info(f'[進度] {pct:.1f}% ({i}/{len(pending)}) | 已寫入 {total_written} 筆 | 剩餘約 {remaining_h:.1f} 小時')

        except KeyboardInterrupt:
            log.info('[中斷] 使用者中斷，進度已儲存，下次重跑自動繼續')
            break
        except Exception as e:
            log.error(f'  {trade_date} 整體失敗: {e}')
            error_days.append(trade_date)
            # 失敗日期不加入 completed，下次重跑時會再試

    log.info(f'[完成] 共寫入 {total_written} 筆')
    log.info(f'[完成] 已完成 {len(completed)} / {len(all_days)} 天')
    if error_days:
        log.warning(f'[失敗] {len(error_days)} 天未完成：{error_days[:10]}{"..." if len(error_days) > 10 else ""}')
        log.info('[提示] 重新執行腳本可自動重試失敗日期')


if __name__ == '__main__':
    main()
