"""
FlowIQ — 台股籌碼分析平台 — FastAPI 後端
支援 SQLite（本地開發）和 PostgreSQL（Railway 部署）
"""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
import secrets, os, math
from datetime import date

app = FastAPI(title="FlowIQ — 台股籌碼分析平台", version="0.1.0")


@app.on_event("startup")
def startup():
    """啟動時自動建立資料表"""
    import logging
    try:
        from db.schema import init_db
        init_db()
    except Exception as e:
        logging.error(f"[startup] init_db failed: {e}")


@app.get("/admin/init-db")
def admin_init_db():
    """手動觸發建表（一次性使用）"""
    try:
        from db.schema import init_db
        init_db()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBasic()

USERS = {
    os.getenv("ADMIN_USER", "admin"): os.getenv("ADMIN_PASS", "stocklens2026"),
    os.getenv("KCHENG_USER", "kcheng"): os.getenv("KCHENG_PASS", "kcheng2026"),
}

DATABASE_URL = os.getenv("DATABASE_URL")  # Railway 自動注入
DB_PATH = os.getenv("DB_PATH", "stocklens.db")


# ── DB 連線（自動偵測 SQLite / PostgreSQL）──────────────────────────────────
def get_db():
    if DATABASE_URL:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL)
        conn.cursor_factory = psycopg2.extras.RealDictCursor
    else:
        import sqlite3
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _q(sql: str) -> str:
    """SQLite 用 ?，PostgreSQL 用 %s"""
    return sql.replace("?", "%s") if DATABASE_URL else sql


def run_query(db, sql: str, params=None) -> list[dict]:
    params = params or []
    if DATABASE_URL:
        cur = db.cursor()
        cur.execute(_q(sql), params)
        return [dict(r) for r in cur.fetchall()]
    else:
        return [dict(r) for r in db.execute(sql, params).fetchall()]


def run_scalar(db, sql: str, params=None):
    params = params or []
    if DATABASE_URL:
        cur = db.cursor()
        cur.execute(_q(sql), params)
        row = cur.fetchone()
        return list(row.values())[0] if row else None
    else:
        import sqlite3
        row = db.execute(sql, params).fetchone()
        return row[0] if row else None


# ── Auth ────────────────────────────────────────────────────────────────────
def auth(credentials: HTTPBasicCredentials = Depends(security)):
    pw = USERS.get(credentials.username)
    if not pw or not secrets.compare_digest(credentials.password, pw):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"message": "FlowIQ — 台股籌碼分析平台 API", "version": "0.1.0"}


@app.get("/api/chip")
def get_chip(
    stock_id: str,
    start: str = None,
    end: str = None,
    limit: int = 30,
    user: str = Depends(auth),
    db=Depends(get_db),
):
    sql = """
        SELECT date, stock_id, foreign_net, trust_net, dealer_net, inst_net,
               margin_balance, short_balance, close_price
        FROM chip_daily
        WHERE stock_id = ?
    """
    params = [stock_id]
    if start:
        sql += " AND date >= ?"
        params.append(start)
    if end:
        sql += " AND date <= ?"
        params.append(end)
    sql += " ORDER BY date DESC LIMIT ?"
    params.append(limit)
    return run_query(db, sql, params)


@app.get("/api/chip/multi")
def get_chip_multi(
    stocks: str,
    start: str = None,
    end: str = None,
    user: str = Depends(auth),
    db=Depends(get_db),
):
    ids = [s.strip() for s in stocks.split(",")]
    placeholders = ",".join("?" * len(ids))
    sql = f"""
        SELECT date, stock_id, foreign_net, trust_net, dealer_net, inst_net,
               margin_balance, short_balance, close_price
        FROM chip_daily
        WHERE stock_id IN ({placeholders})
    """
    params = ids[:]
    if start:
        sql += " AND date >= ?"
        params.append(start)
    if end:
        sql += " AND date <= ?"
        params.append(end)
    sql += " ORDER BY stock_id, date DESC"
    return run_query(db, sql, params)


@app.get("/api/summary")
def get_summary(
    date_str: str = None,
    top: int = 20,
    user: str = Depends(auth),
    db=Depends(get_db),
):
    if not date_str:
        date_str = run_scalar(db, "SELECT MAX(date) FROM chip_daily")

    rows = run_query(db, """
        SELECT date, stock_id, inst_net, foreign_net, trust_net,
               dealer_net, margin_balance, short_balance, close_price
        FROM chip_daily
        WHERE date = ?
        ORDER BY inst_net DESC
        LIMIT ?
    """, [date_str, top])

    return {"date": date_str, "data": rows}


@app.get("/api/dates")
def get_dates(user: str = Depends(auth), db=Depends(get_db)):
    rows = run_query(db, "SELECT DISTINCT date FROM chip_daily ORDER BY date DESC")
    return [r["date"] for r in rows]


@app.get("/api/stocks")
def get_stocks(user: str = Depends(auth), db=Depends(get_db)):
    """回傳 {stock_id: name} 對照表"""
    rows = run_query(db, "SELECT stock_id, name FROM stocks")
    return {r["stock_id"]: r["name"] for r in rows}


@app.get("/api/signals")
def get_signals(
    top: int = 50,
    user: str = Depends(auth),
    db=Depends(get_db),
):
    """T2 訊號排行 — Z-score 異常偵測 + 法人一致性加權"""
    latest = run_scalar(db, "SELECT MAX(date) FROM chip_daily")
    if not latest:
        return {"date": None, "data": []}

    latest_rows = run_query(db, """
        SELECT stock_id, foreign_net, trust_net, dealer_net, inst_net,
               close_price, margin_balance, short_balance
        FROM chip_daily WHERE date = ?
    """, [latest])

    results = []
    for row in latest_rows:
        sid = row["stock_id"]
        hist = run_query(db, """
            SELECT date, foreign_net, close_price
            FROM chip_daily WHERE stock_id = ?
            ORDER BY date ASC
        """, [sid])

        if len(hist) < 2:
            continue

        hist_vals = [h["foreign_net"] for h in hist[:-1]]
        mean_f = sum(hist_vals) / len(hist_vals)
        variance = sum((x - mean_f) ** 2 for x in hist_vals) / len(hist_vals)
        std_f = variance ** 0.5
        z_score = (row["foreign_net"] - mean_f) / std_f if std_f > 0 else 0.0

        consec_buy = 0
        for h in reversed(hist):
            if h["foreign_net"] > 0:
                consec_buy += 1
            else:
                break

        consec_sell = 0
        for h in reversed(hist):
            if h["foreign_net"] < 0:
                consec_sell += 1
            else:
                break

        last5 = hist[-5:] if len(hist) >= 5 else hist
        cum5 = sum(h["foreign_net"] for h in last5)

        prices = [h["close_price"] for h in hist if h["close_price"] is not None and h["close_price"] > 0]
        pct5 = 0.0
        if len(prices) >= 2:
            base = prices[-min(6, len(prices))]
            if base > 0:
                pct5 = (prices[-1] - base) / base * 100

        three_same = row["foreign_net"] > 0 and row["trust_net"] > 0 and row["dealer_net"] > 0

        base_score = consec_buy * math.log(max(abs(cum5), 1)) * (1 - pct5 / 100)
        z_mult = 1.5 if z_score > 2 else (1.25 if z_score > 1 else 1.0)
        cons_mult = 1.3 if three_same else 1.0
        score = base_score * z_mult * cons_mult

        if three_same and z_score > 1.5:
            signal_type = "triple_arrow"
        elif z_score > 2 and pct5 < 3 and consec_buy >= 2:
            signal_type = "stealth_entry"
        elif row["foreign_net"] > 0 and row["trust_net"] > 0:
            signal_type = "trust_push"
        elif pct5 > 10 and row["margin_balance"] > 0:
            signal_type = "retail_chase"
        else:
            signal_type = "normal"

        if consec_buy >= 5 or z_score > 2:
            light = "red"
        elif consec_buy >= 3 or z_score > 1:
            light = "yellow"
        else:
            light = "gray"

        results.append({
            "stock_id": sid,
            "score": round(score, 2),
            "z_score": round(z_score, 2),
            "foreign_net": row["foreign_net"],
            "trust_net": row["trust_net"],
            "dealer_net": row["dealer_net"],
            "inst_net": row["inst_net"],
            "close_price": row["close_price"],
            "consec_buy": consec_buy,
            "consec_sell": consec_sell,
            "cum5_foreign": cum5,
            "pct5": round(pct5, 2),
            "three_consistent": three_same,
            "signal_type": signal_type,
            "light": light,
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return {"date": latest, "data": results[:top]}


@app.get("/api/stock/{stock_id}/stats")
def get_stock_stats(
    stock_id: str,
    user: str = Depends(auth),
    db=Depends(get_db),
):
    """T1 個股摘要統計卡"""
    rows = run_query(db, """
        SELECT date, foreign_net, trust_net, dealer_net, inst_net,
               margin_balance, short_balance, close_price
        FROM chip_daily WHERE stock_id = ?
        ORDER BY date ASC
    """, [stock_id])

    if not rows:
        raise HTTPException(status_code=404, detail="Stock not found")

    consec_buy = 0
    for r in reversed(rows):
        if r["foreign_net"] > 0:
            consec_buy += 1
        else:
            break

    consec_sell = 0
    for r in reversed(rows):
        if r["foreign_net"] < 0:
            consec_sell += 1
        else:
            break

    last5 = rows[-5:] if len(rows) >= 5 else rows
    last20 = rows[-20:] if len(rows) >= 20 else rows
    cum5 = sum(r["foreign_net"] for r in last5)
    cum20 = sum(r["foreign_net"] for r in last20)

    prices = [r["close_price"] for r in rows if r["close_price"] is not None and r["close_price"] > 0]
    pct5 = 0.0
    if len(prices) >= 2:
        base = prices[-min(6, len(prices))]
        if base > 0:
            pct5 = (prices[-1] - base) / base * 100

    hist_vals = [r["foreign_net"] for r in rows[:-1]] if len(rows) > 1 else []
    mean_f = sum(hist_vals) / len(hist_vals) if hist_vals else 0.0
    variance = sum((x - mean_f) ** 2 for x in hist_vals) / len(hist_vals) if hist_vals else 0.0
    std_f = variance ** 0.5
    today_f = rows[-1]["foreign_net"] if rows else 0
    z_score = (today_f - mean_f) / std_f if std_f > 0 else 0.0

    latest = rows[-1]
    three_same = latest["foreign_net"] > 0 and latest["trust_net"] > 0 and latest["dealer_net"] > 0

    return {
        "stock_id": stock_id,
        "latest_date": rows[-1]["date"],
        "latest_price": prices[-1] if prices else None,
        "consec_buy": consec_buy,
        "consec_sell": consec_sell,
        "cum5_foreign": cum5,
        "cum20_foreign": cum20,
        "pct5": round(pct5, 2),
        "z_score": round(z_score, 2),
        "three_consistent": three_same,
        "total_days": len(rows),
    }
