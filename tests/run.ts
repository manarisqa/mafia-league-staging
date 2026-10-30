// Run in one process so Node reports every subtest and assertion, including
// import-time fixture failures, in restricted environments without worker IPC.
import "./database.test";
import "./rating.test";
import "./referee.test";
import "./identity.test";
