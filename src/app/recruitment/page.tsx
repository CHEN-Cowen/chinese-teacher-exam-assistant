"use client";

import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import { LinkButton } from "@/components/ui/LinkButton";
import { PublicRecruitment } from "@/components/opportunities/PublicRecruitment";
import { useCurrentUser } from "@/lib/auth";

export default function RecruitmentPage() {
  const { status } = useCurrentUser();
  return (
    <main className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8">
      <Link href="/" aria-label="教招有据首页"><BrandMark size="lg" /></Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-ink">招聘公告</h1>
        <LinkButton
          href={status === "authenticated" ? "/opportunities" : "/onboarding"}
          variant="primary"
        >
          按我的条件筛选
        </LinkButton>
      </div>
      <PublicRecruitment />
    </main>
  );
}
