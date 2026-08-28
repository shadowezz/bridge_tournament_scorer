import { cookies } from "next/headers";
import { CLIENT_COOKIE } from "@/lib/cookies";

/**
 * The requesting browser's anonymous id. Empty only if middleware has not
 * run yet, in which case every entry is treated as belonging to someone
 * else - the safe direction to fail.
 */
export async function clientId(): Promise<string> {
  return (await cookies()).get(CLIENT_COOKIE)?.value ?? "";
}
