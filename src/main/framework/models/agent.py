from main.framework.models.database import Base
from sqlalchemy import JSON, Column, String


class Agent(Base):
    __tablename__ = "agents"

    name = Column(String, primary_key=True)
    description = Column(String)
    capabilities = Column(JSON)
    tools = Column(JSON)
    mode = Column(String, default="agent")
