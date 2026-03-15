"""
資料庫 Schema — 台版 StockLens
SQLite（開發）/ PostgreSQL（正式）雙支援
切換只需改 DATABASE_URL
"""
import os
from sqlalchemy import (
    create_engine, Column, String, Integer, BigInteger,
    Float, Date, UniqueConstraint, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker

# 開發用 SQLite；正式換成：postgresql://user:pass@host/dbname
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///stocklens.db')

engine = create_engine(DATABASE_URL, echo=False)
Session = sessionmaker(bind=engine)
Base = declarative_base()


class Stock(Base):
    """股票基本資料"""
    __tablename__ = 'stocks'

    stock_id = Column(String(10), primary_key=True)
    name     = Column(String(50))
    market   = Column(String(10))  # TWSE / TPEX


class ChipDaily(Base):
    """每日籌碼資料"""
    __tablename__ = 'chip_daily'

    id       = Column(Integer, primary_key=True, autoincrement=True)
    date     = Column(Date, nullable=False)
    stock_id = Column(String(10), nullable=False)

    # 三大法人（單位：股）
    foreign_buy  = Column(BigInteger, default=0)
    foreign_sell = Column(BigInteger, default=0)
    foreign_net  = Column(BigInteger, default=0)
    trust_buy    = Column(BigInteger, default=0)
    trust_sell   = Column(BigInteger, default=0)
    trust_net    = Column(BigInteger, default=0)
    dealer_net   = Column(BigInteger, default=0)
    inst_net     = Column(BigInteger, default=0)  # 三大合計

    # 融資融券（單位：張）
    margin_balance = Column(Integer, default=0)  # 融資餘額
    short_balance  = Column(Integer, default=0)  # 融券餘額

    # 收盤價
    close_price = Column(Float)

    __table_args__ = (
        UniqueConstraint('date', 'stock_id', name='uq_date_stock'),
        Index('ix_date', 'date'),
        Index('ix_stock_id', 'stock_id'),
    )


def init_db():
    Base.metadata.create_all(engine)
    print('[DB] 資料表初始化完成')


if __name__ == '__main__':
    init_db()
