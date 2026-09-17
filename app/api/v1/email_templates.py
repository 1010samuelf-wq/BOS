"""Saved product-email templates.

Gated on the orders section: this is counter work — answering a customer who
asked what's available — not an admin setting.

Nothing here sends anything. The dashboard builds the email and the person
sends it from their own mailbox, so the shop's domain never has to become a
sending domain and there is no list, no bounce handling and no unsubscribe
machinery to get wrong.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import not_found
from app.core.permissions import require_section
from app.database import get_db
from app.models import EmailTemplate, User
from app.schemas.email_template import EmailTemplateIn, EmailTemplateOut
from app.services import trash as trash_service

router = APIRouter(
    prefix="/email-templates", tags=["email"],
    dependencies=[Depends(require_section("orders"))],
)


def _get(db: Session, template_id: int) -> EmailTemplate:
    row = db.get(EmailTemplate, template_id)
    if row is None:
        raise not_found(f"Template {template_id} not found")
    return row


@router.get("", response_model=list[EmailTemplateOut])
def list_templates(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return db.execute(
        select(EmailTemplate).order_by(EmailTemplate.name)
    ).scalars().all()


@router.post("", response_model=EmailTemplateOut, status_code=201)
def create_template(
    payload: EmailTemplateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = EmailTemplate(**payload.model_dump(), created_by=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{template_id}", response_model=EmailTemplateOut)
def update_template(
    template_id: int,
    payload: EmailTemplateIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    row = _get(db, template_id)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = _get(db, template_id)
    trash_service.record(
        db,
        kind="email_template",
        label=f'Email template "{row.name}" ({len(row.product_ids)} products)',
        payload=trash_service.snapshot(
            row, ["name", "subject", "intro", "signoff", "product_ids"]
        ),
        user=user,
    )
    db.delete(row)
    db.commit()
