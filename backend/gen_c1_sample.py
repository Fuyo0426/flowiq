"""生成 C1 樣本 Markdown"""
import sqlite3, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

c = sqlite3.connect('stocklens.db')

stocks = [
    ('2330','台積電 TSMC'),('2317','鴻海 Foxconn'),('2454','聯發科 MediaTek'),
    ('2382','廣達 Quanta'),('2881','富邦金 Fubon Fin'),('3008','大立光 Largan'),
    ('2412','中華電 ChungHwa Tel'),('2308','台達電 Delta'),('6505','台塑化 Formosa Petro'),
]

def fmt(v):
    v2 = v // 1000
    return ('+' if v2 >= 0 else '') + f'{v2:,}K'

lines = []
lines.append('# FlowIQ C1 樣本 — 籌碼分析資料確認表')
lines.append('')
lines.append('**版本**：C1 初稿  **日期**：2026-03-15  **截止確認**：2026-03-22')
lines.append('**資料來源**：TWSE T86（三大法人）+ MI_MARGN（融資融券）+ STOCK_DAY（收盤價）')
lines.append('')
lines.append('---')
lines.append('')
lines.append('## 資料格式說明')
lines.append('')
lines.append('| 欄位 | 單位 | 說明 |')
lines.append('|---|---|---|')
lines.append('| 外資買賣超 | 張（K=千張） | TWSE T86，含外資自營商合計 |')
lines.append('| 投信買賣超 | 張 | TWSE T86 |')
lines.append('| 自營商買賣超 | 張 | TWSE T86（自行+避險合計）|')
lines.append('| 三大合計 | 張 | 外資+投信+自營 |')
lines.append('| 融資餘額 | 張 | TWSE MI_MARGN，目前存當日餘額 |')
lines.append('| 融券餘額 | 張 | 同上 |')
lines.append('| 收盤價 | NT$ | TWSE STOCK_DAY，每日正確 |')
lines.append('')
lines.append('> **C1 確認問題（請 KCheng 在 3/22 前回覆）**：')
lines.append('> 1. 欄位夠不夠？有無遺漏習慣看的指標？')
lines.append('> 2. 買賣超要用**張數**還是**金額（NT$）**？（目前為張數）')
lines.append('> 3. 融資要看**餘額**還是**當日增減量**？（目前為餘額）')
lines.append('> 4. 要不要納入**千張大戶持股比**（每週更新，需接 FinMind API）？')
lines.append('> 5. 分析目標是**個股異動**，還是**類股板塊輪動**？')
lines.append('')
lines.append('---')
lines.append('')

for sid, name in stocks:
    rows = c.execute('''
        SELECT date, foreign_net, trust_net, dealer_net, inst_net,
               margin_balance, short_balance, close_price
        FROM chip_daily WHERE stock_id=? ORDER BY date ASC
    ''', (sid,)).fetchall()
    if not rows:
        continue
    lines.append(f'## {sid} {name}')
    lines.append('')
    lines.append('| 日期 | 外資 | 投信 | 自營 | 三大合計 | 融資餘額 | 融券餘額 | 收盤 |')
    lines.append('|---|---:|---:|---:|---:|---:|---:|---:|')
    for r in rows:
        d, fn, tn, dn, inst, mg, sh, cl = r
        cl_str = f'{cl:.1f}' if cl else '-'
        lines.append(f'| {d} | {fmt(fn)} | {fmt(tn)} | {fmt(dn)} | {fmt(inst)} | {mg:,} | {sh:,} | {cl_str} |')
    lines.append('')

lines.append('---')
lines.append('')
lines.append('## 資料品質備注')
lines.append('')
lines.append('| 項目 | 狀態 | 說明 |')
lines.append('|---|---|---|')
lines.append('| TWSE 三大法人 | ✅ 正確 | 每日獨立資料，來自 T86 API |')
lines.append('| TWSE 收盤價 | ✅ 正確 | 來自 STOCK_DAY，按日準確 |')
lines.append('| TPEX 三大法人 | ✅ 補齊 | 已回填，來自 3itrade_hedge_result |')
lines.append('| TPEX 收盤價 | ✅ 正確 | 來自 dailyQuotes |')
lines.append('| 融資融券（歷史）| ⚠️ 限制 | TWSE MI_MARGN 無歷史端點，目前存最新日餘額，待研究替代方案 |')
lines.append('| 千張大戶持股 | ❌ 未接 | 需 FinMind API，C2 前確認是否需要 |')
lines.append('')
lines.append('*Jack & Harrison L1 × FlowIQ 資料工程 | 2026-03-15*')

print('\n'.join(lines))
c.close()
