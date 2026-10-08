const EARLY_BIRD_PLAN_ID = process.env.WHOP_EARLY_BIRD_PLAN_ID || "";
const EARLY_BIRD_LIMIT = 200;

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Whop API not configured" });
  }

  try {
    const planResponse = await fetch(
      `https://api.whop.com/api/v1/plans/${EARLY_BIRD_PLAN_ID}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Api-Version-Date": "2026-09-25",
        },
        cache: "no-store",
      }
    );

    const planPayload = await planResponse.json().catch(() => null);
    const plan = planPayload?.data ?? planPayload;

    if (!planResponse.ok) {
      return res.status(502).json({
        error: "Unable to read Whop plan status",
        whop_status: planResponse.status,
      });
    }

    // Whop only exposes plan.stock to authorized team members. If it is
    // available, use it directly because it is the authoritative remaining stock.
    if (typeof plan?.stock === "number" || plan?.unlimited_stock === true) {
      const stock =
        plan?.unlimited_stock === true
          ? null
          : Math.max(0, Number(plan.stock));

      return res.status(200).json({
        available: plan?.unlimited_stock === true || (stock !== null && stock > 0),
        stock,
        unlimited_stock: plan?.unlimited_stock === true,
        source: "plan",
      });
    }

    // Fallback: count memberships for this plan through Whop Stats.
    // This requires the API key to have stats:read.
    const sql = `SELECT COUNT(*) AS purchase_count FROM SCOPED_DATA WHERE plan_id = '${EARLY_BIRD_PLAN_ID}'`;
    const statsUrl =
      "https://api.whop.com/api/v1/stats/sql" +
      "?resource=payments:membership" +
      "&sql=" +
      encodeURIComponent(sql) +
      "&limit=1";

    const statsResponse = await fetch(statsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Api-Version-Date": "2026-09-25",
      },
      cache: "no-store",
    });

    const statsPayload = await statsResponse.json().catch(() => null);

    if (!statsResponse.ok) {
      return res.status(502).json({
        error: "Whop plan stock is private and Stats access is unavailable",
        required_permission: "stats:read",
        whop_status: statsResponse.status,
      });
    }

    const columns = Array.isArray(statsPayload?.columns)
      ? statsPayload.columns
      : [];
    const rows = Array.isArray(statsPayload?.data) ? statsPayload.data : [];
    const countIndex = columns.indexOf("purchase_count");
    const purchaseCount =
      countIndex >= 0 && Array.isArray(rows[0])
        ? Number(rows[0][countIndex])
        : Number(rows[0]?.purchase_count);

    if (!Number.isFinite(purchaseCount)) {
      return res.status(502).json({
        error: "Unable to determine Early Bird purchase count",
        required_permission: "stats:read",
      });
    }

    const remaining = Math.max(0, EARLY_BIRD_LIMIT - purchaseCount);

    return res.status(200).json({
      available: remaining > 0,
      stock: remaining,
      unlimited_stock: false,
      source: "stats",
      purchase_count: purchaseCount,
      limit: EARLY_BIRD_LIMIT,
    });
  } catch {
    return res.status(502).json({
      error: "Unable to read Early Bird availability",
    });
  }
}
