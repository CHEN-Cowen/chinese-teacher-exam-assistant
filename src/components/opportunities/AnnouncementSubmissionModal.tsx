"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select, Textarea, Input } from "@/components/ui/Input";
import {
  CITY_OPTIONS,
  PROVINCE_OPTIONS,
} from "@/lib/guest/guestSession";
import { validateSubmissionForm } from "@/lib/opportunities/announcement-submission";

interface AnnouncementSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (input: {
    officialUrl: string;
    publisherName: string;
    regionCode: string;
    note?: string;
  }) => void;
}

/**
 * 公告补录弹窗（D08 / PRD 11.9 U08）：
 * 用户报告未收录的官方公告（官方链接、发布单位、地区、可选说明）。
 * 提交只进入运营待办队列，不直接进入采集与发布；服务端会做同样的
 * 链接安全校验、限流与去重。
 */
export function AnnouncementSubmissionModal({
  isOpen,
  onClose,
  submitting,
  onSubmit,
}: AnnouncementSubmissionModalProps) {
  const [officialUrl, setOfficialUrl] = useState("");
  const [publisherName, setPublisherName] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const cityOptions = provinceCode ? (CITY_OPTIONS[provinceCode] ?? []) : [];

  const reset = () => {
    setOfficialUrl("");
    setPublisherName("");
    setProvinceCode("");
    setCityCode("");
    setNote("");
    setError("");
  };

  const handleSubmit = () => {
    const regionCode = cityCode || provinceCode;
    const result = validateSubmissionForm({
      officialUrl,
      publisherName,
      regionCode,
      note,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSubmit(result.value);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        reset();
      }}
      title="补录官方公告"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              reset();
            }}
            disabled={submitting}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "提交中…" : "提交补录"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          如果你发现某条官方招聘公告还没有被收录，可以提交官方链接供我们核对。
          补录只进入运营待办，经人工核对后才会纳入监测，不会自动发布或影响你的判断结果。
        </p>
        <Input
          label="官方公告链接（http/https）"
          value={officialUrl}
          maxLength={500}
          onChange={(e) => {
            setOfficialUrl(e.target.value);
            setError("");
          }}
          placeholder="例如：https://hrss.example.gov.cn/2026/notice-123"
        />
        <Input
          label="发布单位"
          value={publisherName}
          maxLength={100}
          onChange={(e) => {
            setPublisherName(e.target.value);
            setError("");
          }}
          placeholder="例如：某市人力资源和社会保障局"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="所属省份"
            placeholder="选择省份"
            options={PROVINCE_OPTIONS.map((p) => ({
              value: p.code,
              label: p.name,
            }))}
            value={provinceCode}
            onChange={(e) => {
              setProvinceCode(e.target.value);
              setCityCode("");
              setError("");
            }}
          />
          {cityOptions.length > 0 && (
            <Select
              label="所属城市（可选）"
              placeholder="选择城市"
              options={cityOptions.map((c) => ({
                value: c.code,
                label: c.name,
              }))}
              value={cityCode}
              onChange={(e) => {
                setCityCode(e.target.value);
                setError("");
              }}
            />
          )}
        </div>
        <Textarea
          label="补充说明（可选）"
          value={note}
          maxLength={500}
          onChange={(e) => {
            setNote(e.target.value);
            setError("");
          }}
          placeholder="例如：公告标题、发文单位或你认为需要核对的原因。"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
