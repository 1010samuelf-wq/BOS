"""Product names worth a second look: doubles, and names with a number in them.

Both come from how the catalog was built - typed in by hand on a tablet,
imported from the baker's list, read off photos - so the same thing ends up
in it twice ("Rum Balls" and "rum ball"), or a name carries a leftover
number ("Babka 2", "Product number 12"). A double splits sales and stock
across two rows; a stray number ends up on the website and on receipts.

Some numbers are meant to be there ("6 Pack", "12 inch cake"), so a person
can mark a name as fine (`Product.name_ok`); renaming the product clears
that mark, because the new name hasn't been looked at. Only products still
on sale are checked: a retired double no longer splits anything.

Read by GET /products/flags (the easy app's Products screen and the
dashboard catalog), and by the problem checker.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Product

_FILLER = {"the", "a", "an"}


def _singular(word: str) -> str:
    """Brings a plural and its singular to the same form — not real English
    singulars. "-ies" can come from "-y" (berries) or "-ie" (cookies), so a
    final consonant + "y" is written "ie": berry, berries -> "berrie";
    cookie, cookies -> "cookie"; pie, pies -> "pie"."""
    if len(word) > 3 and re.search(r"(ch|sh|ss|x|z)es$", word):
        word = word[:-2]
    elif len(word) > 2 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    if len(word) > 2 and re.search(r"[^aeiou]y$", word):
        word = word[:-1] + "ie"
    return word


def name_key(name: str) -> str:
    """What two names have in common if they're the same product:
    case, spacing, punctuation, "&"/"and", plurals and "the" ignored."""
    text = name.lower().replace("&", " and ")
    words = re.findall(r"[0-9a-z֐-׿]+", text)
    return " ".join(_singular(w) for w in words if w not in _FILLER)


def has_number(name: str) -> bool:
    return bool(re.search(r"\d", name))


@dataclass
class Flag:
    product_id: int
    name: str
    reasons: list[str] = field(default_factory=list)  # "duplicate" | "number"
    # The other products it looks like a double of.
    duplicate_of: list[dict] = field(default_factory=list)

    def describe(self) -> str:
        parts = []
        if "duplicate" in self.reasons:
            others = ", ".join(f'"{d["name"]}"' for d in self.duplicate_of)
            parts.append(f"looks like a double of {others}")
        if "number" in self.reasons:
            parts.append("has a number in its name")
        return f'"{self.name}" ' + " and ".join(parts)


def find(db: Session) -> list[Flag]:
    """Every product on sale whose name needs a look, in name order."""
    products = db.scalars(
        select(Product).where(Product.active.is_(True)).order_by(Product.name)
    ).all()
    by_key: dict[str, list[Product]] = {}
    for p in products:
        by_key.setdefault(name_key(p.name), []).append(p)

    flags: list[Flag] = []
    for p in products:
        if p.name_ok:
            continue
        flag = Flag(product_id=p.id, name=p.name)
        twins = [o for o in by_key.get(name_key(p.name), []) if o.id != p.id]
        if twins:
            flag.reasons.append("duplicate")
            flag.duplicate_of = [{"id": o.id, "name": o.name} for o in twins]
        if has_number(p.name):
            flag.reasons.append("number")
        if flag.reasons:
            flags.append(flag)
    return flags
