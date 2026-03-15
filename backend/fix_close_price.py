"""
修正收盤價：按日期批次抓取 TWSE STOCK_DAY_ALL + TPEX dailyQuotes
每次 API 回傳當日所有股票，9 個日期 = 9 次 API（高效率版）
"""
import sys, io, ssl, json, time, sqlite3, re
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0'}
DELAY = 1.5


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        return r.read()


def western_to_roc(date_str):
    """2026-03-13 -> 115/03/13"""
    y, m, d = date_str.split('-')
    return f'{int(y)-1911}/{m}/{d}'


def western_to_yyyymmdd(date_str):
    return date_str.replace('-', '')


conn = sqlite3.connect('stocklens.db')
cur = conn.cursor()

cur.execute('SELECT DISTINCT date FROM chip_daily ORDER BY date')
dates = [r[0] for r in cur.fetchall()]
print(f'共 {len(dates)} 個交易日需修正: {dates}')

total_updated = 0

for date_str in dates:
    trade_date = western_to_yyyymmdd(date_str)
    updated_this_date = 0

    # ── TWSE 收盤價（上市）─────────────────────────────
    url_twse = f'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date={trade_date}'
    print(f'[{date_str}] TWSE 收盤價...')
    try:
        raw = fetch(url_twse)
        data = json.loads(raw.decode('utf-8'))
        if data.get('stat') == 'OK':
            for row in data.get('data', []):
                sid = str(row[0]).strip()
                try:
                    price = float(str(row[7]).replace(',', ''))
                    cur.execute(
                        'UPDATE chip_daily SET close_price=? WHERE date=? AND stock_id=?',
                        (price, date_str, sid)
                    )
                    updated_this_date += cur.rowcount
                except (ValueError, IndexError):
                    pass
            print(f'  TWSE: +{updated_this_date} 筆')
        else:
            print(f'  TWSE 無資料: {data.get("stat")}')
    except Exception as e:
        print(f'  TWSE 失敗: {e}')
    time.sleep(DELAY)

    # ── TPEX 收盤價（上櫃）─────────────────────────────
    roc = western_to_roc(date_str)
    url_tpex = f'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?d={roc}&response=json'
    tpex_updated = 0
    try:
        raw = fetch(url_tpex)
        try:
            data = json.loads(raw.decode('utf-8'))
        except Exception:
            data = json.loads(raw.decode('big5', errors='replace'))
        for table in data.get('tables', []):
            for row in table.get('data', []):
                if not isinstance(row, list) or len(row) < 3:
                    continue
                sid = str(row[0]).strip()
                try:
                    price = float(str(row[2]).replace(',', '').strip())
                    if price > 0:
                        cur.execute(
                            'UPDATE chip_daily SET close_price=? WHERE date=? AND stock_id=?',
                            (price, date_str, sid)
                        )
                        tpex_updated += cur.rowcount
                except (ValueError, IndexError):
                    pass
        print(f'  TPEX: +{tpex_updated} 筆')
        updated_this_date += tpex_updated
    except Exception as e:
        print(f'  TPEX 失敗: {e}')
    time.sleep(DELAY)

    conn.commit()
    total_updated += updated_this_date
    print(f'  [{date_str}] 共更新 {updated_this_date} 筆')

print(f'\n完成，共更新收盤價 {total_updated} 筆')
conn.close()
