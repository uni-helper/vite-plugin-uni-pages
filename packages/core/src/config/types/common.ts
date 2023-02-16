export type RGBColor = `rgb(${number}, ${number}, ${number})`
export type RGBAColor = `rgba(${number}, ${number}, ${number}, ${number})`
export type HEXColor = `#${string}`
export type ThemeColor = `@${string}`

export type Color = RGBColor | RGBAColor | HEXColor
