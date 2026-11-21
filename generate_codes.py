"""
AppSumo deal-code generator — NOT license keys.

Generates redemption codes to upload to the AppSumo seller dashboard.
When a buyer redeems one, confirm it in the dashboard and then issue the
actual license key with:

    node scripts/appsumo-keys.mjs issue --count 1 --batch <name>

(see bookmarkforge-2026-4/docs/appsumo-license-keys.md)

Security notes:
- Uses `secrets` (CSPRNG), not `random`.
- Codes are bearer credentials until redeemed: keep the CSV out of git
  and delete it once the batch is uploaded to AppSumo.
"""

import secrets
import string
import sys

ALPHABET = string.ascii_uppercase + string.digits
CODE_COUNT = 1000
OUTPUT_FILE = "appsumo_codes.csv"


def generate_code() -> str:
    part1 = "".join(secrets.choice(ALPHABET) for _ in range(4))
    part2 = "".join(secrets.choice(ALPHABET) for _ in range(4))
    return f"BMKF-{part1}-{part2}"


def generate_codes_csv(filename: str, count: int) -> None:
    seen: set[str] = set()
    with open(filename, "w", encoding="utf-8", newline="") as f:
        f.write("code\n")
        for _ in range(count):
            code = generate_code()
            while code in seen:  # paranoia: 36^8 space makes this ~never hit
                code = generate_code()
            seen.add(code)
            f.write(f"{code}\n")
    print(f"Generated {count} codes in {filename}")


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else CODE_COUNT
    generate_codes_csv(OUTPUT_FILE, count)
