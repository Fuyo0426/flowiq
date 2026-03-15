"""
FlowIQ — 台股籌碼分析平台 — FastAPI 後端
支援 SQLite（本地開發）和 PostgreSQL（Railway 部署）
"""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
import secrets, os
from datetime import date

app = FastAPI(title="FlowIQ — 台股籌碼分析平台", version="0.1.0")

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
