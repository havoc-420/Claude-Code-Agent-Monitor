const { Router } = require("express");
const { stmts } = require("../db");
const { getConnectionCount } = require("../websocket");

const router = Router();

const VALID_PLATFORMS = ["claude", "codebuddy"];

router.get("/", (req, res) => {
  const platform = req.query.platform;

  // Use platform-filtered queries when platform is specified
  if (platform && VALID_PLATFORMS.incldes(platform)) {
    const overview = stmts.statsByPlatform.get(platform, platform, platform, platform, platform);
    const agentsByStatus = stmts.agentStatusCountsByPlatform.all(platform);
    const sessionsByStatus = stmts.sessionStatusCountsByPlatform.all(platform);
    const eventsToday = stmts.countEventsTodayByPlatform.get(platform);

    return res.json({
      ...overview,
      events_today: eventsToday?.count ?? 0,
      ws_connections: getConnectionCount(),
      agents_by_status: Object.fromEntries(agentsByStatus.map((r) => [r.status, r.count])),
      sessions_by_status: Object.fromEntries(sessionsByStatus.map((r) => [r.status, r.count])),
      platform,
    });
  }

  // Default: all platforms
  const overview = stmts.statsAll.get();
  const agentsByStatus = stmts.agentStatusCounts.all();
  const sessionsByStatus = stmts.sessionStatusCounts.all();

  const eventsToday = stmts.countEventsToday.get();

  res.json({
    ...overview,
    events_today: eventsToday?.count ?? 0,
    ws_connections: getConnectionCount(),
    agents_by_status: Object.fromEntries(agentsByStatus.map((r) => [r.status, r.count])),
    sessions_by_status: Object.fromEntries(sessionsByStatus.map((r) => [r.status, r.count])),
  });
});

module.exports = router;
