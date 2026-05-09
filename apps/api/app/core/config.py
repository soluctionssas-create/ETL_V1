from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_name: str = "etl-contable-saas"
    database_url: str = "postgresql+psycopg://etl_user:etl_pass@localhost:5432/etl_saas"
    redis_url: str = "redis://localhost:6379/0"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672//"
    jwt_secret: str = "change_me"
    jwt_issuer: str = "etl-contable"
    jwt_audience: str = "etl-api"
    jwt_expires_minutes: int = 30
    cors_origins: list[str] = ["http://localhost:3000"]
    upload_max_mb: int = 20

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, value):
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value


settings = Settings()
