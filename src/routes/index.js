import KoaRouter from "koa-router";
import { Index, Info, Refresh, RefreshStatus, Status } from "../controllers";

export const router = new KoaRouter();

router.get("/", Index);
router.get("/api/status", Status);
router.get("/api/refresh", Refresh);
router.get("/api/refresh-status", RefreshStatus);
router.get("/api/info", Info);
