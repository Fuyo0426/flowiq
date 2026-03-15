"""
TPEX 爬蟲 — 上櫃股票三大法人 + 收盤價 + 融資融券
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


def _fetch_big5(url: str) -> dict:
    """TPEX 部分端點回傳 Big5，需特別處理"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        raw = r.read()
    try:
        return json.loads(raw.decode('big5', errors='replace'))
    except json.JSONDecodeError:
        return json.loads(raw.decode('utf-8', errors='replace'))


def fetch_tpex_institutional(trade_date: str) -> dict:
    """
    TPEX 三大法人每日買賣超
    URL: /web/stock/3insti/daily_trade/3itrade_hedge_result.php
    欄位：[0]代號 [1]名稱
          [8]外資買進 [9]外資賣出 [10]外資買賣超（含外資自營商）
          [11]投信買進 [12]投信賣出 [13]投信買賣超
          [22]自營商買賣超（含避險）
          [23]三大法人買賣超合計
    回傳 {stock_id: {foreign_buy, foreign_sell, foreign_net, trust_buy, trust_sell, trust_net, dealer_net, inst_net}}
    """
    roc = western_to_roc(trade_date).replace('/', '%2F')
    url = f'{BASE}/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&t=D&d={roc}&response=json'
    log.info(f'[TPEX 三大法人] {trade_date}')
    data = _fetch_big5(url)

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

    log.info(f'  TPEX 三大法人：{len(result)} 支')
    return result


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
    資料優先順序：三大法人 > 收盤價 > 融資融券
    """
    from db.schema import ChipDaily
    from datetime import datetime

    inst   = fetch_tpex_institutional(trade_date)
    time.sleep(DELAY)
    price  = fetch_tpex_price(trade_date)
    time.sleep(DELAY)
    margin = fetch_tpex_margin(trade_date)

    if not price and not inst:
        log.warning(f'  {trade_date} TPEX 無資料，跳過')
        return 0

    dt = datetime.strptime(trade_date, '%Y%m%d').date()
    count = 0

    # 以三大法人或收盤價的聯集作為股票清單
    all_sids = set(inst.keys()) | set(price.keys())

    for sid in all_sids:
        try:
            exists = session.query(ChipDaily).filter_by(date=dt, stock_id=sid).first()
        except Exception:
            session.rollback()
            exists = session.query(ChipDaily).filter_by(date=dt, stock_id=sid).first()

        close = price.get(sid)
        mg    = margin.get(sid, {})
        d     = inst.get(sid, {})

        if exists:
            # 更新三大法人（如果有）
            if d:
                exists.foreign_buy  = d['foreign_buy']
                exists.foreign_sell = d['foreign_sell']
                exists.foreign_net  = d['foreign_net']
                exists.trust_buy    = d['trust_buy']
                exists.trust_sell   = d['trust_sell']
                exists.trust_net    = d['trust_net']
                exists.dealer_net   = d['dealer_net']
                exists.inst_net     = d['inst_net']
            if close is not None:
                exists.close_price = close
            if mg:
                exists.margin_balance = mg['margin_balance']
                exists.short_balance  = mg['short_balance']
        else:
            row = ChipDaily(
                date=dt,
                stock_id=sid,
                foreign_buy=d.get('foreign_buy', 0),
                foreign_sell=d.get('foreign_sell', 0),
                foreign_net=d.get('foreign_net', 0),
                trust_buy=d.get('trust_buy', 0),
                trust_sell=d.get('trust_sell', 0),
                trust_net=d.get('trust_net', 0),
                dealer_net=d.get('dealer_net', 0),
                inst_net=d.get('inst_net', 0),
                margin_balance=mg.get('margin_balance', 0),
                short_balance=mg.get('short_balance', 0),
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
    log.info(f'  TPEX {trade_date} 新增 {count} 筆，三大法人 {len(inst)} 支，收盤價 {len(price)} 支')
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
