---
title: A broken diagram
sources: [src/components/Mermaid.tsx, src/components/Markdown.tsx]
---
A lesson contains one mermaid block with a syntax error, followed by more text and a code
block. What is rendered?

## Options
- [ ] An error page replaces the whole lesson
- [ ] The source as a plain code block, with no error shown
- [ ] Every block except the diagram, which is silently dropped
- [x] An error box for that diagram; the rest renders normally

## Explanation
`Markdown` routes ```` ```mermaid ```` fences to `Mermaid`. When `mermaid.render()` throws,
`Mermaid` sets an error state and renders a `render-error mermaid-error` box with the message
and the source. Only that block is affected.
