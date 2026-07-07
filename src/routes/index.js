import KoaRouter from "koa-router";
import { Index, Info, Status } from "../controllers";

export const router = new KoaRouter();

router.get("/", Index);
router.get("/api/status", Status);
router.get("/api/info", Info);
