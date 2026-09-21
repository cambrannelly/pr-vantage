import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { listRepos } from "@/lib/repos";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz", "SOFT"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PR Vantage",
  description: "Architecture-first pull request review",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const repos = await listRepos();
  return (
    <html lang="en" className={`${fraunces.variable} ${instrument.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full">
        <div className="relative z-10 flex min-h-screen">
          <Sidebar repos={repos} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
