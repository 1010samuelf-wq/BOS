from fastapi import APIRouter

from app.api.v1 import (
    auth,
    catalog,
    deliveries,
    employees,
    expenses,
    health,
    notifications,
    orders,
    reports,
    settings,
    stock,
    tasks,
    time,
    ws,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(orders.router)
api_router.include_router(stock.router)
api_router.include_router(catalog.router)
api_router.include_router(employees.router)
api_router.include_router(time.router)
api_router.include_router(expenses.router)
api_router.include_router(reports.router)
api_router.include_router(deliveries.router)
api_router.include_router(notifications.router)
api_router.include_router(tasks.router)
api_router.include_router(settings.router)
api_router.include_router(ws.router)
