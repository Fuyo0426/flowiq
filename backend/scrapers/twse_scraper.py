"""
TWSE 爬蟲 — 三大法人 + 融資融券 + 收盤價
每日 16:30 後執行
"""
import sys, io, json, ssl, time, logging
from datetime import date, timedelta
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
DELAY = 2  # 秒


def _fetch(url: str) -> dict | list:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


def _int(s: str) -> int:
    try:
        return int(str(s).replace(',', '').replace(' ', ''))
    except Exception:
        return 0


def _float(s: str) -> float:
    try:
        return float(str(s).replace(',', '').replace(' ', ''))
    except Exception:
        return 0.0


def fetch_institutional(trade_date: str) -> dict:
    """
    T86：個股三大法人買賣超
    trade_date: YYYYMMDD
    回傳 {stock_id: {foreign_net, trust_net, dealer_net, inst_net, ...}}
    """
    url = f'https://www.twse.com.tw/fund/T86?response=json&date={trade_date}&selectType=ALL'
    log.info(f'[三大法人] {trade_date}')
    data = _fetch(url)

    if data.get('stat') != 'OK':
        log.warning(f'  三大法人無資料: {data.get("stat")}')
        return {}

    # fields: 證券代號, 證券名稱, 外陸資買進, 外陸資賣出, 外陸資買賣超,
    #         外資自營商買進, 外資自營商賣出, 外資自營商買賣超,
    #         投信買進, 投信賣出, 投信買賣超,
    #         自營商買賣超, 自營商買進(自行), 自營商賣出(自行), 自營商買賣超(自行),
    #         自營商買進(避險), 自營商賣出(避險), 自營商買賣超(避險), 三大法人買賣超
    result = {}
    for row in data.get('data', []):
        sid = row[0].strip()
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
    log.info(f'  三大法人：{len(result)} 支')
    return result


def fetch_margin(trade_date: str) -> dict:
    """
    OpenAPI MI_MARGN：個股融資融券餘額
    回傳 {stock_id: {margin_balance, short_balance}}
    """
    url = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN'
    log.info(f'[融資融券] {trade_date}')
    data = _fetch(url)

    result = {}
    for row in data:
        sid = row.get('股票代號', '').strip()
        if not sid:
            continue
        result[sid] = {
            'margin_balance': _int(row.get('融資今日餘額', 0)),
            'short_balance':  _int(row.get('融券今日餘額', 0)),
        }
    log.info(f'  融資融券：{len(result)} 支')
    return result


def fetch_price(trade_date: str) -> dict:
    """
    STOCK_DAY_ALL：全市場收盤價
    回傳 {stock_id: close_price}
    """
    url = f'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date={trade_date}'
    log.info(f'[收盤價] {trade_date}')
    data = _fetch(url)

    if data.get('stat') != 'OK':
        log.warning(f'  收盤價無資料: {data.get("stat")}')
        return {}

    # fields: 證券代號, 證券名稱, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數
    result = {}
    for row in data.get('data', []):
        sid = row[0].strip()
        result[sid] = _float(row[7])  # 收盤價
    log.info(f'  收盤價：{len(result)} 支')
    return result


def scrape_date(trade_date: str, session) -> int:
    """
    爬取單一交易日，寫入資料庫
    trade_date: YYYYMMDD
    回傳寫入筆數
    """
    from db.schema import ChipDaily
    from datetime import datetime

    inst   = fetch_institutional(trade_date)
    time.sleep(DELAY)
    margin = fetch_margin(trade_date)
    time.sleep(DELAY)
    price  = fetch_price(trade_date)

    if not inst:
        log.warning(f'  {trade_date} 無三大法人資料，跳過')
        return 0

    dt = datetime.strptime(trade_date, '%Y%m%d').date()
    count = 0

    for sid, d in inst.items():
        # 去重：已存在則跳過
        exists = session.query(ChipDaily).filter_by(date=dt, stock_id=sid).first()
        if exists:
            continue

        row = ChipDaily(
            date=dt,
            stock_id=sid,
            foreign_buy=d['foreign_buy'],
            foreign_sell=d['foreign_sell'],
            foreign_net=d['foreign_net'],
            trust_buy=d['trust_buy'],
            trust_sell=d['trust_sell'],
            trust_net=d['trust_net'],
            dealer_net=d['dealer_net'],
            inst_net=d['inst_net'],
            margin_balance=margin.get(sid, {}).get('margin_balance', 0),
            short_balance=margin.get(sid, {}).get('short_balance', 0),
            close_price=price.get(sid),
        )
        session.add(row)
        count += 1

    session.commit()
    log.info(f'  {trade_date} 寫入 {count} 筆')
    return count


def get_recent_trading_days(n: int = 10) -> list[str]:
    """取得最近 n 個可能的交易日（排除週六週日）"""
    days = []
    d = date.today()
    while len(days) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:  # 週一到週五
            days.append(d.strftime('%Y%m%d'))
    return days


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent))
    from db.schema import init_db, Session

    init_db()
    session = Session()

    # 預設爬最近 10 個交易日
    days = get_recent_trading_days(10)
    log.info(f'準備爬取 {len(days)} 個交易日: {days[0]} ~ {days[-1]}')

    total = 0
    for d in reversed(days):  # 從舊到新
        try:
            n = scrape_date(d, session)
            total += n
        except Exception as e:
            log.error(f'  {d} 失敗: {e}')
        time.sleep(DELAY)

    log.info(f'完成，共寫入 {total} 筆')
    session.close()
