import { createClient } from "@supabase/supabase-js";

// 서버 코드(API 라우트)에서만 사용. service_role(secret) 키를 쓰므로
// 클라이언트 컴포넌트에서 절대 import하지 않는다.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
