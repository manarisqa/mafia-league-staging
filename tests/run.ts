// Run in one process so Node reports every subtest and assertion, including
// import-time fixture failures, in restricted environments without worker IPC.
import "./database.test";
import "./rating.test";
import "./referee.test";
import "./referee-layout.test";
import "./identity.test";

import "./guided-referee.test";
import "./guided-database.test";
import "./club-evenings.test";
import "./seasons.test";
import "./player-insights.test";
import "./communications.test";
import "./admin-analytics.test";
