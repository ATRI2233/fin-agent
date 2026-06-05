from sqlalchemy import create_engine, Table, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base

from main.framework.config import Settings

settings = Settings()

engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
