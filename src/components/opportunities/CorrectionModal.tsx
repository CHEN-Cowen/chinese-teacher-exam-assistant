"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select, Textarea, Input } from "@/components/ui/Input";

/**
 * 问题位置选项（D08 / PRD 11.9）：补齐匹配结论、失效链接、重复收录。
 * 与后端 corrections.domain FIELD_PATH_LABELS 同口径；遗漏公告走
 * 补录通道（AnnouncementSubmissionModal），不占用单元纠错位置。
 */
const FIELD_OPTIONS = [
  { value: "major", label: "专业目录 / 资格条件" },
  { value: "timeline", label: "报名时间 / 考试安排" },
  { value: "headcount", label: "招聘人数 / 岗位信息" },
  { value: "evidence", label: "官方来源或原文摘录" },
  { value: "matching", label: "匹配结论（符合/不符合判断）" },
  { value: "dead_link", label: "官方链接失效" },
  { value: "duplicate", label: "重复收录" },
  { value: "other", label: "其他问题" },
];

interface CorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  submitting: boolean;
  /** 打开时预选的问题位置（如从逐条件解释行进入，自动带上该条件） */
  initialFieldPath?: string;
  onSubmit: (input: {
    fieldPath: string;
    content: string;
    contact?: string;
  }) => void;
}

/**
 * 纠错入口（PRD 7.10 / 11.9）：
 * 提交后只在后台留痕，由运营核对并走发布新版本，不会自动改判。
 */
export function CorrectionModal({
  isOpen,
  onClose,
  submitting,
  initialFieldPath,
  onSubmit,
}: CorrectionModalProps) {
  const [fieldPath, setFieldPath] = useState(initialFieldPath ?? "");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");

  const reset = () => {
    setFieldPath("");
    setContent("");
    setContact("");
    setError("");
  };

  const handleSubmit = () => {
    if (!fieldPath) {
      setError("请选择要纠错的内容位置。");
      return;
    }
    if (content.trim().length < 5) {
      setError("请填写至少 5 个字的说明，便于我们核对官方原文。");
      return;
    }
    onSubmit({
      fieldPath,
      content: content.trim(),
      contact: contact.trim() || undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        reset();
      }}
      title="提交信息纠错"
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
            {submitting ? "提交中…" : "提交纠错"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          如果你发现页面内容与官方公告不一致，请指出位置并说明。我们会核对官方原文；
          确认有误的，将通过新版本更正，不会直接改动结论。
        </p>
        <Select
          label="问题位置"
          placeholder="选择要纠错的内容"
          options={FIELD_OPTIONS}
          value={fieldPath}
          onChange={(e) => {
            setFieldPath(e.target.value);
            setError("");
          }}
        />
        <Textarea
          label="纠错说明（至少 5 个字）"
          value={content}
          maxLength={1000}
          onChange={(e) => {
            setContent(e.target.value);
            setError("");
          }}
          placeholder="例如：补充公告里初中语文岗位实际扩招到 10 人，页面仍是 8 人。"
        />
        <Input
          label="联系方式（可选）"
          value={contact}
          maxLength={200}
          onChange={(e) => setContact(e.target.value)}
          placeholder="需要回访时使用，不会公开展示"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
