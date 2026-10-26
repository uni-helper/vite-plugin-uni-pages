import type { CommentLineToken, CommentToken } from 'comment-json'
import { isGenerationMarker } from './platform-variants'

/** 构建用于序列化 pages.json 输出或数组元素包裹的行注释令牌 */
export function lineComment(value: string): CommentLineToken {
  return {
    type: 'LineComment',
    value,
    inline: false,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }
}

/**
 * 找到条目前面的条件编译开启指令。
 *
 * comment-json 会把包裹层的 #endif（输出在值的逗号后面）挂到下一个条目
 * 前面，所以只认 #ifdef/#ifndef 开头，绝不能把 #endif 当成开启符。
 */
export function findConditionalComment(beforeComments: CommentToken[] | undefined): CommentLineToken | undefined {
  return beforeComments?.find((comment): comment is CommentLineToken =>
    comment.type !== 'BlankLine' && /^#(?:ifdef|ifndef)/.test(comment.value.trim()),
  )
}

/**
 * 手写 #ifndef 块原样保留时清理包裹注释。
 *
 * 只保留开启这个块的那条指令和用户写的说明文字；前一个块收尾的 #endif
 * 和重复的结构指令都要丢掉，否则每次重跑都会多出游离的 #endif 或嵌套。
 */
export function sanitizePassthroughComments(beforeComments: CommentToken[] | undefined, opening: CommentLineToken): CommentToken[] {
  const sanitized: CommentToken[] = []
  let openingKept = false
  for (const comment of beforeComments || []) {
    if (isGenerationMarker(comment))
      continue
    if (comment.type === 'BlankLine') {
      sanitized.push(comment)
      continue
    }
    if (/^#(?:ifdef|ifndef|endif)/.test(comment.value.trim())) {
      if (!openingKept && comment === opening) {
        sanitized.push(comment)
        openingKept = true
      }
      continue
    }
    sanitized.push(comment)
  }
  return sanitized
}
