"""
TPEX 爬蟲 — 上櫃股票收盤價 + 融資融券
每日 16:30 後執行
注意：TPEX 日期格式為民國年 115/03/13
"""
import sys, io, json, ssl, time, logging, re
from datetime import date, timedelta
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
DELAY = 2
BASE = 'https://www.tpex.org.tw'


def _fetch(url: str):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


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
    m = trade_date[4:6]
    d = trade_date[6:8]
    return f'{y}/{m}/{d}'


def fetch_tpex_price(trade_date: str) -> dict:
    """
    dailyQuotes：上櫃個股收盤價
    回傳 {stock_id: close_price}
    """
    roc = western_to_roc(trade_date)
    url = f'{BASE}/www/zh-tw/afterTrading/dailyQuotes?d={roc}&response=json'
    log.info(f'[TPEX 收盤價] {trade_date}')
    data = _fetch(url)

    tables = data.get('tables', [])
    result = {}
    for table in tables:
        for row in table.get('data', []):
            if not isinstance(row, list) or len(row) < 3:
                continue
            sid = str(row[0]).strip()
            price = _float(row[2])  # 收盤
            if sid and price:
                result[sid] = price

    log.info(f'  TPEX 收盤價：{len(result)} 支')
    return result


def fetch_tpex_margin(trade_date: str) -> dict:
    """
    margin/balance：上櫃融資融券餘額
    回傳 {stock_id: {margin_balance, short_balance}}
    """
    roc = western_to_roc(trade_date)
    url = f'{BASE}/www/zh-tw/margin/balance?d={roc}&response=json'
    log.info(f'[TPEX 融資融券] {trade_date}')
    data = _fetch(url)

    tables = data.get('tables', [])
    result = {}
    for table in tables:
        fields = table.get('fields', [])
        # 找融資餘額和融券餘額的欄位索引
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

    log.info(f'  TPEX 融資融券：{len(result)} 支')
    return result


def scrape_tpex_date(trade_date: str, session) -> int:
    """
    爬取 TPEX 單一交易日，更新或新增資料庫
    trade_date: YYYYMMDD
    """
    from db.schema import ChipDaily
    from datetime import datetime

    price  = fetch_tpex_price(trade_date)
    time.sleep(DELAY)
    margin = fetch_tpex_margin(trade_date)

    if not price:
        log.warning(f'  {trade_date} TPEX 無收盤價資料，跳過')
        return 0

    dt = datetime.strptime(trade_date, '%Y%m%d').date()
    count = 0

    for sid, close in price.items():
        try:
            exists = session.query(ChipDaily).filter_by(date=dt, stock_id=sid).first()
        except Exception:
            session.rollback()
            exists = session.query(ChipDaily).filter_by(date=dt, stock_id=sid).first()
        if exists:
            # 更新收盤價和融資融券
            exists.close_price = close
            mg = margin.get(sid, {})
            if mg:
                exists.margin_balance = mg['margin_balance']
                exists.short_balance  = mg['short_balance']
        else:
            # 新增上櫃股票記錄（無三大法人資料，填 0）
            mg = margin.get(sid, {})
            row = ChipDaily(
                date=dt,
                stock_id=sid,
                foreign_buy=0, foreign_sell=0, foreign_net=0,
                trust_buy=0,   trust_sell=0,   trust_net=0,
                dealer_net=0,  inst_net=0,
                margin_balance=mg.get('margin_balance', 0),
                short_balance= mg.get('short_balance', 0),
                close_price=close,
            )
            session.add(row)
            count += 1

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        log.error(f'  TPEX {trade_date} commit 失敗: {e}')
        return 0
    log.info(f'  TPEX {trade_date} 新增 {count} 筆，更新收盤價 {len(price)} 支')
    return count


def get_recent_trading_days(n: int = 10) -> list[str]:
    days = []
    d = date.today()
    while len(days) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            days.append(d.strftime('%Y%m%d'))
    return days


if __name__ == '__main__':
    import sys as _sys
    _sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent))
    from db.schema import init_db, Session

    init_db()
    session = Session()

    days = get_recent_trading_days(10)
    log.info(f'TPEX 準備爬取 {len(days)} 個交易日')

    total = 0
    for d in reversed(days):
        try:
            n = scrape_tpex_date(d, session)
            total += n
        except Exception as e:
            log.error(f'  {d} 失敗: {e}')
        time.sleep(DELAY)

    log.info(f'TPEX 完成，共新增 {total} 筆')
    session.close()
