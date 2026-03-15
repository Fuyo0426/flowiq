"""
回填 TPEX 三大法人歷史資料
每次抓一日所有上櫃股票，9 個日期 = 9 次 API
"""
import sys, io, ssl, json, time, sqlite3
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0'}
BASE = 'https://www.tpex.org.tw'
DELAY = 2


def fetch_big5(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        raw = r.read()
    try:
        return json.loads(raw.decode('big5', errors='replace'))
    except Exception:
        return json.loads(raw.decode('utf-8', errors='replace'))


def _int(s):
    try:
        return int(str(s).replace(',', '').strip())
    except Exception:
        return 0


def western_to_roc_enc(date_str):
    """2026-03-13 -> 115%2F03%2F13"""
    y, m, d = date_str.split('-')
    return f'{int(y)-1911}%2F{m}%2F{d}'


conn = sqlite3.connect('stocklens.db')
cur = conn.cursor()

cur.execute('SELECT DISTINCT date FROM chip_daily ORDER BY date')
dates = [r[0] for r in cur.fetchall()]
print(f'共 {len(dates)} 個交易日: {dates}')

total_updated = 0

for date_str in dates:
    roc = western_to_roc_enc(date_str)
    url = f'{BASE}/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&t=D&d={roc}&response=json'
    print(f'[{date_str}] TPEX 三大法人...')

    try:
        data = fetch_big5(url)
        updated = 0
        for table in data.get('tables', []):
            for row in table.get('data', []):
                if not isinstance(row, list) or len(row) < 24:
                    continue
                sid = str(row[0]).strip()
                if not sid:
                    continue
                try:
                    foreign_buy  = _int(row[8])
                    foreign_sell = _int(row[9])
                    foreign_net  = _int(row[10])
                    trust_buy    = _int(row[11])
                    trust_sell   = _int(row[12])
                    trust_net    = _int(row[13])
                    dealer_net   = _int(row[22])
                    inst_net     = _int(row[23])
                except (IndexError, ValueError):
                    continue

                # 已有記錄 → 更新；無記錄 → INSERT（純上櫃股票，收盤價待後續填入）
                cur.execute('SELECT id FROM chip_daily WHERE date=? AND stock_id=?', (date_str, sid))
                exists = cur.fetchone()
                if exists:
                    cur.execute('''
                        UPDATE chip_daily SET
                            foreign_buy=?, foreign_sell=?, foreign_net=?,
                            trust_buy=?,   trust_sell=?,   trust_net=?,
                            dealer_net=?,  inst_net=?
                        WHERE date=? AND stock_id=?
                    ''', (foreign_buy, foreign_sell, foreign_net,
                          trust_buy, trust_sell, trust_net,
                          dealer_net, inst_net, date_str, sid))
                    updated += cur.rowcount
                else:
                    cur.execute('''
                        INSERT OR IGNORE INTO chip_daily
                        (date, stock_id, foreign_buy, foreign_sell, foreign_net,
                         trust_buy, trust_sell, trust_net, dealer_net, inst_net,
                         margin_balance, short_balance)
                        VALUES (?,?,?,?,?,?,?,?,?,?,0,0)
                    ''', (date_str, sid, foreign_buy, foreign_sell, foreign_net,
                          trust_buy, trust_sell, trust_net, dealer_net, inst_net))
                    updated += cur.rowcount

        conn.commit()
        total_updated += updated
        print(f'  更新/新增 {updated} 筆')

    except Exception as e:
        print(f'  失敗: {e}')

    time.sleep(DELAY)

print(f'\n完成，TPEX 三大法人共更新 {total_updated} 筆')
conn.close()
