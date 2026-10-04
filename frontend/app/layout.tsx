import "./globals.css";
export const metadata = {
  title: "27Nuts · 赛事管理后台",
  description: "27Nuts 智力竞技馆赛事运营管理",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
