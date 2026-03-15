"""
修正融資融券歷史資料：從 TWSE MI_MARGN 按日期逐日拉取
TWSE MI_MARGN 歷史端點：每次抓一日所有股票，效率高
"""
import sys, io, ssl, json, time, sqlite3
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0'}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


def _int(s):
    try:
        return int(str(s).replace(',', '').strip())
    except Exception:
        return 0


conn = sqlite3.connect('stocklens.db')
cur = conn.cursor()

# 取得 DB 中所有日期
cur.execute('SELECT DISTINCT date FROM chip_daily ORDER BY date')
dates = [r[0] for r in cur.fetchall()]
print(f'共 {len(dates)} 個交易日需修正: {dates}')

total_updated = 0

for date_str in dates:
    trade_date = date_str.replace('-', '')  # 2026-03-02 → 20260302
    url = f'https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date={trade_date}&selectType=ALL'
    print(f'[{date_str}] 抓取融資融券...')

    try:
        data = fetch(url)
        if data.get('stat') != 'OK':
            print(f'  無資料: {data.get("stat")}')
            continue

        updated = 0
        for row in data.get('data', []):
            if not isinstance(row, list) or len(row) < 10:
                continue
            sid = str(row[0]).strip()
            # 欄位：股票代號, 股票名稱, 融資買進, 融資賣出, 融資現金償還, 融資今日餘額, 融資限額,
            #       融券賣出, 融券買進, 融券現金償還, 融券今日餘額, 融券限額, 資券相抵
            try:
                margin_balance = _int(row[5])
                short_balance  = _int(row[10])
            except (IndexError, Exception):
                continue

            cur.execute(
                'UPDATE chip_daily SET margin_balance=?, short_balance=? WHERE date=? AND stock_id=?',
                (margin_balance, short_balance, date_str, sid)
            )
            updated += cur.rowcount

        conn.commit()
        total_updated += updated
        print(f'  更新 {updated} 筆')

    except Exception as e:
        print(f'  失敗: {e}')

    time.sleep(1.5)

print(f'\n完成，共更新融資融券 {total_updated} 筆')
conn.close()
