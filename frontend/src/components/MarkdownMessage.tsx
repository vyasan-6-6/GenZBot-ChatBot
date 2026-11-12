"use client";

import {
  isValidElement,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function detectLanguage(children: ReactNode): string {
  if (!isValidElement<{ className?: string }>(children)) {
    return "code";
  }
  const className = children.props.className ?? "";
  const match = /\blanguage-([a-z0-9_+-]+)/i.exec(className);
  return match ? match[1].toLowerCase() : "code";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below if clipboard API is unavailable
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function CodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const language = detectLanguage(children);
  const rawCode = extractText(children).replace(/\n$/, "");

  async function handleCopy() {
    const ok = await copyTextToClipboard(rawCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{language}</span>
        <button
          type="button"
          className="code-copy-btn"
          onClick={() => void handleCopy()}
          aria-label={`Copy ${language} code`}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="code-block-pre">{children}</pre>
    </div>
  );
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: (props) => <CodeBlock {...props} />,
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...rest}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

