"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useMemo, useState } from "react";
import type { TocItem } from "@/lib/markdown-parser";
import type { Components } from "react-markdown";

interface ReportContentProps {
  markdown: string | null;
  /** 与目录共用同一份计算结果，保证锚点与目录完全一致 */
  toc: TocItem[];
}

/** 安全的 rehype-sanitize 白名单：禁用脚本、事件属性与 javascript: 协议 */
const sanitizeSchema = {
  tagNames: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "strong", "em", "del", "mark",
    "blockquote", "code", "pre",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "div", "span",
  ],
  attributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["className"],
    span: ["className"],
    div: ["className"],
    th: ["align"],
    td: ["align"],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

/** 标题旁的锚点按钮：点击即复制该章节的完整链接，同时保留浏览器原生跳转 */
function HeadingAnchor({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <a
      href={`#${id}`}
      title="复制本节链接"
      aria-label="复制本节链接"
      onClick={() => {
        const url = `${window.location.origin}${window.location.pathname}#${id}`;
        navigator.clipboard
          ?.writeText(url)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            /* 剪贴板不可用时仍可正常跳转 */
          });
      }}
      className="ml-2 align-middle text-[var(--color-text-muted)] opacity-40 md:opacity-0 md:group-hover:opacity-100 transition-opacity no-underline hover:text-[var(--color-accent-light)]"
    >
      {copied ? <span className="text-[10px] text-green-400">已复制</span> : <span className="text-sm">#</span>}
    </a>
  );
}

export function ReportContent({ markdown, toc }: ReportContentProps) {
  // 标题 id 由目录推导，行号作为唯一映射键，避免重名标题造成锚点错位
  const idByLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of toc) map.set(item.line, item.id);
    return map;
  }, [toc]);

  const components = useMemo<Components>(() => {
    const heading =
      (Tag: "h1" | "h2" | "h3") =>
      ({ node, children }: { node?: { position?: { start: { line: number } } }; children?: React.ReactNode }) => {
        const line = node?.position?.start.line;
        const id = line !== undefined ? idByLine.get(line) : undefined;
        return (
          <Tag id={id} className="group scroll-mt-24">
            {children}
            {id && <HeadingAnchor id={id} />}
          </Tag>
        );
      };

    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      a: ({ children, href }) => {
        const isExternal = !!href && /^https?:\/\//i.test(href);
        return (
          <a
            href={href}
            {...(isExternal ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
          >
            {children}
          </a>
        );
      },
      table: ({ children }) => (
        <div className="overflow-x-auto my-4">
          <table>{children}</table>
        </div>
      ),
    };
  }, [idByLine]);

  if (!markdown || !markdown.trim()) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          该报告在数据库中暂无正文内容（report_markdown 为空）
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-5 sm:p-7 lg:p-10">
      <div className="prose-report max-w-[52rem] mx-auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
