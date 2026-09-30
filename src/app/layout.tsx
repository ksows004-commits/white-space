import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "화이트스페이스",
  description: "발사체 부품 시나리오 선택 및 분석 결과",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
