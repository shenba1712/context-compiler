"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-label="Hero composition">
        <div className="copy">
          <p className="brand">
            Context <span>Compiler</span>
          </p>
          <p className="coords">MCP · LOCAL BM25 · NO KEY FOR COMPILE</p>
          <h1 className="title">Stop paying for pages your agent doesn’t read.</h1>
          <p className="lede">
            Chart the useful terrain in any file, then pack only the sections your task needs, under a
            budget you set. Plug it into any AI agent over MCP, or try it right here.
          </p>
          <div className="cta">
            <Link className="btn primary" href="/demo">
              Try it now
            </Link>
            <a
              className="btn ghost"
              href="https://github.com/shenba1712/context-compiler"
              target="_blank"
              rel="noopener noreferrer"
            >
              View the code
            </a>
          </div>
        </div>

        <aside
          className="plane"
          role="img"
          aria-label="Example: Pride and Prejudice compiled from 19,612 tokens to 775 tokens. 96% reduction."
        >
          <div className="plane-inner">
            <p className="cap">
              Pride &amp; Prejudice · “What does Mr. Bingley think of Jane Bennet early on?”
            </p>
            <div className="bar-block">
              <div className="bar-label">
                <span>Whole file</span>
                <span className="tokens">19,612 tokens</span>
              </div>
              <div className="htrack">
                <motion.div
                  className="hbar raw"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  style={{ width: "100%", transformOrigin: "left center" }}
                />
              </div>
            </div>
            <div className="bar-block">
              <div className="bar-label">
                <span>Compiled</span>
                <span className="tokens">775 tokens</span>
              </div>
              <div className="htrack">
                <motion.div
                  className="hbar small"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.9, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{ width: "4%", transformOrigin: "left center" }}
                />
              </div>
            </div>
            <p className="verdict">
              <strong>96% fewer tokens</strong> Same facts. Every read.
            </p>
          </div>
        </aside>
      </section>

      <section className="pipeline" aria-label="How it works">
        <div className="wrap">
          <div className="pipe">
            <div className="c">
              <div className="n">1 · Convert</div>
              <div className="h">Any file → markdown</div>
              <div className="d">
                PDF, docx, xlsx, pptx, images. Cached by content hash — convert once, ask new questions
                for free.
              </div>
            </div>
            <div className="c">
              <div className="n">2 · Select</div>
              <div className="h">Rank against your task</div>
              <div className="d">BM25 lexical ranking: free, local, and deterministic.</div>
            </div>
            <div className="c">
              <div className="n">3 · Pack</div>
              <div className="h">Pack under a token ceiling</div>
              <div className="d">
                Coverage-first: best sections in, stop when the question is covered. Manifest lists what
                was left out.
              </div>
            </div>
          </div>
          <div className="keynote">
            The compiled result is <strong>exactly what your AI agent receives instead of the whole file</strong>.
            None of this needs an API key. A key unlocks <strong>Prove answer parity</strong> and{" "}
            <strong>Run agent</strong>.
          </div>
        </div>
      </section>
    </>
  );
}
