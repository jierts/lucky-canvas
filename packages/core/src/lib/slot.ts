import Lucky from './lucky'
import { UserConfigType, ImgType, ImgItemType, Tuple } from '../types/index'
import SlotMachineConfig, {
  BlockType,
  PrizeType,
  SlotType,
  DefaultConfigType,
  DefaultStyleType,
  EndCallbackType,
} from '../types/slot'
import {
  get, has,
  isExpectType,
  removeEnter,
  computePadding,
  hasBackground,
  computeRange,
  splitText,
  getSortedArrayByIndex
} from '../utils/index'
import { roundRectByArc } from '../utils/math'
import { quad } from '../utils/tween'

export default class SlotMachine extends Lucky {
  // 背景
  private blocks: Array<BlockType> = []
  // 奖品列表
  private prizes: Array<PrizeType> = []
  // 插槽列表
  private slots: Array<SlotType> = []
  // 默认配置
  private defaultConfig: DefaultConfigType = {}
  private _defaultConfig: Required<DefaultConfigType> = {} as Required<DefaultConfigType>
  // 默认样式
  private defaultStyle: DefaultStyleType = {}
  private _defaultStyle: Required<DefaultStyleType> = {} as Required<DefaultStyleType>
  private endCallback: EndCallbackType = () => {}
  // 离屏canvas
  private _offscreenCanvas?: HTMLCanvasElement
  private cellWidth = 0             // 格子宽度
  private cellHeight = 0            // 格子高度
  private cellAndSpacing = 0        // 格子+间距
  private widthAndSpacing = 0       // 格子宽度+列间距
  private heightAndSpacing = 0      // 格子高度+行间距
  private FPS = 16.6                // 屏幕刷新率
  private scroll: number[] = []     // 滚动的长度
  private stopScroll: number[] = [] // 刻舟求剑
  private endScroll: number[] = []  // 最终停止的长度
  private startTime = 0             // 开始游戏的时间
  private endTime = 0               // 开始停止的时间
  /**
   * 游戏当前的阶段
   * step = 0 时, 游戏尚未开始
   * step = 1 时, 此时处于加速阶段
   * step = 2 时, 此时处于匀速阶段
   * step = 3 时, 此时处于减速阶段
   */
  private step: 0 | 1 | 2 | 3 = 0
  /**
   * 中奖索引
   * prizeFlag = undefined 时, 处于开始抽奖阶段, 正常旋转
   * prizeFlag >= 0 时, 说明stop方法被调用, 并且传入了中奖索引
   * prizeFlag === -1 时, 说明stop方法被调用, 并且传入了负值, 本次抽奖无效
   */
  private prizeFlag: number | undefined = -1
  // 奖品区域几何信息
  private prizeArea?: { x: number, y: number, w: number, h: number }
  // 图片缓存
  private ImageCache = {
    blocks: [] as Array<ImgType[]>,
    prizes: [] as Array<ImgType[]>,
  }

  /**
   * 老虎机构造器
   * @param config 配置项
   * @param data 抽奖数据
   */
   constructor (config: UserConfigType, data: SlotMachineConfig) {
    super(config, {
      width: data.width,
      height: data.height
    })
    this.initData(data)
    this.initWatch()
    this.initComputed()
    // 创建前回调函数
    config.beforeCreate?.call(this)
    // 首次初始化
    this.init()
  }

  protected resize(): void {
    super.resize()
    this.draw()
    this.config.afterResize?.()
  }

  protected initLucky (): void {
    this.cellWidth = 0
    this.cellHeight = 0
    this.cellAndSpacing = 0
    this.widthAndSpacing = 0
    this.heightAndSpacing = 0
    this.FPS = 16.6
    this.scroll = []
    this.stopScroll = []
    this.endScroll = []
    this.startTime = 0
    this.endTime = 0
    this.prizeFlag = -1
    this.step = 0
    super.initLucky()
  }

  /**
   * 初始化数据
   * @param data
   */
  private initData (data: SlotMachineConfig): void {
    this.$set(this, 'width', data.width || '300px')
    this.$set(this, 'height', data.height || '300px')
    this.$set(this, 'blocks', data.blocks || [])
    this.$set(this, 'prizes', data.prizes || [])
    this.$set(this, 'slots', data.slots || [])
    this.$set(this, 'defaultConfig', data.defaultConfig || {})
    this.$set(this, 'defaultStyle', data.defaultStyle || {})
    this.$set(this, 'endCallback', data.end)
  }

  /**
   * 初始化属性计算
   */
  private initComputed (): void {
    // 默认配置
    this.$computed(this, '_defaultConfig', () => {
      const config = {
        mode: 'vertical',
        rowSpacing: 0,
        colSpacing: 5,
        speed: 20,
        direction: 1,
        accelerationTime: 2500,
        decelerationTime: 2500,
        ...this.defaultConfig
      }
      config.rowSpacing = this.getLength(config.rowSpacing)
      config.colSpacing = this.getLength(config.colSpacing)
      return config
    })
    // 默认样式
    this.$computed(this, '_defaultStyle', () => {
      return {
        borderRadius: 0,
        fontColor: '#000',
        fontSize: '18px',
        fontStyle: 'sans-serif',
        fontWeight: '400',
        background: 'rgba(0,0,0,0)',
        wordWrap: true,
        lengthLimit: '90%',
        ...this.defaultStyle
      }
    })
  }

  /**
   * 初始化观察者
   */
  private initWatch (): void {
    // 重置宽度
    this.$watch('width', (newVal: string | number) => {
      this.data.width = newVal
      this.resize()
    })
    // 重置高度
    this.$watch('height', (newVal: string | number) => {
      this.data.height = newVal
      this.resize()
    })
    // 监听 blocks 数据的变化
    this.$watch('blocks', (newData: Array<BlockType>) => {
      this.initImageCache()
    }, { deep: true })
    // 监听 prizes 数据的变化
    this.$watch('prizes', (newData: Array<PrizeType>) => {
      this.initImageCache()
    }, { deep: true })
    // 监听 prizes 数据的变化
    this.$watch('slots', (newData: Array<PrizeType>) => {
      this.drawOffscreenCanvas()
      this.draw()
    }, { deep: true })
    this.$watch('defaultConfig', () => this.draw(), { deep: true })
    this.$watch('defaultStyle', () => this.draw(), { deep: true })
    this.$watch('endCallback', () => this.init())
  }

  /**
   * 初始化 canvas 抽奖
   */
  public async init (): Promise<void> {
    this.initLucky()
    const { config } = this
    // 初始化前回调函数
    config.beforeInit?.call(this)
    // 先绘制一次
    this.drawOffscreenCanvas()
    this.draw()
    // 异步加载图片
    await this.initImageCache()
    // 初始化后回调函数
    config.afterInit?.call(this)
  }

  private initImageCache (): Promise<void> {
    return new Promise((resolve) => {
      const willUpdateImgs = {
        blocks: this.blocks.map(block => block.imgs),
        prizes: this.prizes.map(prize => prize.imgs),
      }
      ;(<(keyof typeof willUpdateImgs)[]>Object.keys(willUpdateImgs)).forEach(imgName => {
        const willUpdate = willUpdateImgs[imgName]
        // 循环遍历所有图片
        const allPromise: Promise<void>[] = []
        willUpdate && willUpdate.forEach((imgs, cellIndex) => {
          imgs && imgs.forEach((imgInfo, imgIndex) => {
            allPromise.push(this.loadAndCacheImg(imgName, cellIndex, imgName, imgIndex))
          })
        })
        Promise.all(allPromise).then(() => {
          this.drawOffscreenCanvas()
          this.draw()
          resolve()
        })
      })
    })
  }

  /**
   * 根据索引单独加载指定图片并缓存
   * @param cellName 模块名称
   * @param cellIndex 模块索引
   * @param imgName 模块对应的图片缓存
   * @param imgIndex 图片索引
   */
  private async loadAndCacheImg (
    cellName: keyof typeof this.ImageCache,
    cellIndex: number,
    imgName: keyof typeof this.ImageCache,
    imgIndex: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let cell: BlockType | PrizeType = this[cellName][cellIndex]
      if (!cell || !cell.imgs) return
      const imgInfo = cell.imgs[imgIndex]
      if (!imgInfo) return
      const ImageCache = this.ImageCache
      if (!ImageCache[imgName][cellIndex]) ImageCache[imgName][cellIndex] = []
      // 异步加载图片
      this.loadImg(imgInfo.src, imgInfo).then(currImg => {
        if (typeof imgInfo.formatter === 'function') {
          currImg = imgInfo.formatter.call(this, currImg)
        }
        ImageCache[imgName][cellIndex][imgIndex] = currImg
        resolve()
      }).catch(err => {
        console.error(`${cellName}[${cellIndex}].imgs[${imgIndex}] ${err}`)
        reject()
      })
    })
  }

  /**
   * 计算图片的渲染宽高
   * @param imgObj 图片标签元素
   * @param imgInfo 图片信息
   * @param maxWidth 最大宽度
   * @param maxHeight 最大高度
   * @return [渲染宽度, 渲染高度]
   */
  private computedWidthAndHeight (
    imgObj: ImgType,
    imgInfo: ImgItemType,
    maxWidth: number,
    maxHeight: number
  ): [number, number] {
    // 根据配置的样式计算图片的真实宽高
    if (!imgInfo.width && !imgInfo.height) {
      // 如果没有配置宽高, 则使用图片本身的宽高
      return [imgObj.width, imgObj.height]
    } else if (imgInfo.width && !imgInfo.height) {
      // 如果只填写了宽度, 没填写高度
      let trueWidth = this.getWidth(imgInfo.width, maxWidth)
      // 那高度就随着宽度进行等比缩放
      return [trueWidth, imgObj.height * (trueWidth / imgObj.width)]
    } else if (!imgInfo.width && imgInfo.height) {
      // 如果只填写了宽度, 没填写高度
      let trueHeight = this.getHeight(imgInfo.height, maxHeight)
      // 那宽度就随着高度进行等比缩放
      return [imgObj.width * (trueHeight / imgObj.height), trueHeight]
    }
    // 如果宽度和高度都填写了, 就如实计算
    return [
      this.getWidth(imgInfo.width, maxWidth),
      this.getHeight(imgInfo.height, maxHeight)
    ]
  }

  /**
   * 绘制离屏canvas
   */
  protected drawOffscreenCanvas (): void {
    const { _defaultConfig, _defaultStyle } = this
    const { w, h } = this.drawBlocks()!
    // 计算单一奖品格子的宽度和高度
    const prizesLen = this.prizes.length
    const { cellWidth, cellHeight, widthAndSpacing, heightAndSpacing } = this.displacementWidthOrHeight()
    const defaultOrder = new Array(prizesLen).fill(void 0).map((v, i) => i)
    let maxOrderLen = 0, maxOffWidth = 0, maxOffHeight = 0
    this.slots.forEach((slot, slotIndex) => {
      // 初始化 scroll 的值
      if (this.scroll[slotIndex] === void 0) this.scroll[slotIndex] = 0
      // 如果没有order属性, 就填充prizes
      slot.order = slot.order || defaultOrder
      // 计算最大值
      const currLen = slot.order.length
      maxOrderLen = Math.max(maxOrderLen, currLen)
      maxOffWidth = Math.max(maxOffWidth, w + widthAndSpacing * currLen)
      maxOffHeight = Math.max(maxOffHeight, h + heightAndSpacing * currLen)
    })
    // 创建一个离屏Canvas来存储画布的内容
    const { _offscreenCanvas, _ctx } = this.getOffscreenCanvas(maxOffWidth, maxOffHeight)!
    this._offscreenCanvas = _offscreenCanvas
    // 绘制插槽
    this.slots.forEach((slot, slotIndex) => {
      const cellX = cellWidth * slotIndex
      const cellY = cellHeight * slotIndex
      let lengthOfCopy = 0
      // 绘制奖品
      const newPrizes = getSortedArrayByIndex(this.prizes, slot.order!)
      // 如果没有奖品则打断逻辑
      if (!newPrizes.length) return
      newPrizes.forEach((cell, cellIndex) => {
        if (!cell) return
        const orderIndex = slot.order![cellIndex]
        const prizesX = widthAndSpacing * cellIndex + _defaultConfig.colSpacing / 2
        const prizesY = heightAndSpacing * cellIndex + _defaultConfig.rowSpacing / 2
        const [_x, _y, spacing] = this.displacement(
          [cellX, prizesY, heightAndSpacing],
          [prizesX, cellY, widthAndSpacing]
        )
        lengthOfCopy += spacing
        // 绘制背景
        const background = cell.background || _defaultStyle.background
        if (hasBackground(background)) {
          const borderRadius = this.getLength(has(cell, 'borderRadius') ? cell.borderRadius : _defaultStyle.borderRadius)
          roundRectByArc(_ctx, _x, _y, cellWidth, cellWidth, borderRadius)
          _ctx.fillStyle = background
          _ctx.fill()
        }
        // 绘制图片
        cell.imgs && cell.imgs.forEach((imgInfo, imgIndex) => {
          const cellImg = get(this.ImageCache, `prizes.${orderIndex}.${imgIndex}`)
          if (!cellImg) return
          const [trueWidth, trueHeight] = this.computedWidthAndHeight(cellImg, imgInfo, cellWidth, cellHeight)
          const [xAxis, yAxis] = [
            _x + this.getOffsetX(trueWidth, cellWidth),
            _y + this.getHeight(imgInfo.top, cellHeight)
          ]
          this.drawImage(_ctx, cellImg, xAxis, yAxis, trueWidth, trueHeight)
        })
        // 绘制文字
        cell.fonts && cell.fonts.forEach(font => {
          // 字体样式
          const style = font.fontStyle || _defaultStyle.fontStyle
          // 字体加粗
          const fontWeight = font.fontWeight || _defaultStyle.fontWeight
          // 字体大小
          const size = this.getLength(font.fontSize || _defaultStyle.fontSize)
          // 字体行高
          const lineHeight = font.lineHeight || _defaultStyle.lineHeight || font.fontSize || _defaultStyle.fontSize
          const wordWrap = Object.prototype.hasOwnProperty.call(font, 'wordWrap') ? font.wordWrap : _defaultStyle.wordWrap
          const lengthLimit = font.lengthLimit || _defaultStyle.lengthLimit
          const lineClamp = font.lineClamp || _defaultStyle.lineClamp
          _ctx.font = `${fontWeight} ${size >> 0}px ${style}`
          _ctx.fillStyle = font.fontColor || _defaultStyle.fontColor
          let lines = [], text = String(font.text)
          // 计算文字换行
          if (wordWrap) {
            // 最大宽度
            let maxWidth = this.getWidth(lengthLimit, cellWidth)
            lines = splitText(_ctx, removeEnter(text), () => maxWidth, lineClamp)
          } else {
            lines = text.split('\n')
          }
          lines.forEach((line, lineIndex) => {
            _ctx.fillText(
              line,
              _x + this.getOffsetX(_ctx.measureText(line).width, cellWidth),
              _y + this.getHeight(font.top, cellHeight) + (lineIndex + 1) * this.getLength(lineHeight)
            )
          })
        })
      })
      const [_x, _y, _w, _h] = this.displacement(
        [cellX, 0, cellWidth, lengthOfCopy],
        [0, cellY, lengthOfCopy, cellHeight]
      )
      let drawLen = lengthOfCopy
      while (drawLen < maxOffHeight + lengthOfCopy) {
        const [drawX, drawY] = this.displacement([_x, drawLen], [drawLen, _y])
        this.drawImage(
          _ctx, _offscreenCanvas,
          _x, _y, _w, _h,
          drawX, drawY, _w, _h
        )
        drawLen += lengthOfCopy
      }
    })
  }

  /**
   * 绘制背景区域
   */
  protected drawBlocks (): SlotMachine['prizeArea'] {
    const { config, ctx, _defaultConfig, _defaultStyle } = this
    // 绘制背景区域, 并计算获取奖品区域
    return this.prizeArea = this.blocks.reduce(({x, y, w, h}, block, blockIndex) => {
      const [paddingTop, paddingBottom, paddingLeft, paddingRight] = computePadding(block)
      const r = block.borderRadius ? this.getLength(block.borderRadius) : 0
      // 绘制边框
      const background = block.background || _defaultStyle.background
      if (hasBackground(background)) {
        roundRectByArc(ctx, x, y, w, h, r)
        ctx.fillStyle = background
        ctx.fill()
      }
      // 绘制图片
      block.imgs && block.imgs.forEach((imgInfo, imgIndex) => {
        const blockImg = get(this.ImageCache, `blocks.${blockIndex}.${imgIndex}`)
        if (!blockImg) return
        // 绘制图片
        const [trueWidth, trueHeight] = this.computedWidthAndHeight(blockImg, imgInfo, w, h)
        const [xAxis, yAxis] = [this.getOffsetX(trueWidth, w), this.getHeight(imgInfo.top, h)]
        this.drawImage(ctx, blockImg, x + xAxis, y + yAxis, trueWidth, trueHeight)
      })
      return {
        x: x + paddingLeft,
        y: y + paddingTop,
        w: w - paddingLeft - paddingRight,
        h: h - paddingTop - paddingBottom
      }
    }, { x: 0, y: 0, w: this.boxWidth, h: this.boxHeight })
  }

  /**
   * 绘制老虎机抽奖
   */
  protected draw (): void {
    const { config, ctx, _defaultConfig, _defaultStyle } = this
    // 触发绘制前回调
    config.beforeDraw?.call(this, ctx)
    // 清空画布
    ctx.clearRect(0, 0, this.boxWidth, this.boxHeight)
    // 绘制背景
    const { x, y, w, h } = this.drawBlocks()!
    // 绘制插槽
    if (!this._offscreenCanvas) return
    const { cellWidth, cellHeight, cellAndSpacing, widthAndSpacing, heightAndSpacing } = this
    this.slots.forEach((slot, slotIndex) => {
      // 绘制临界点
      const _p = cellAndSpacing * slot.order!.length
      // 调整奖品垂直居中
      const start = this.displacement(-(h - heightAndSpacing) / 2, -(w - widthAndSpacing) / 2)
      let scroll = this.scroll[slotIndex] + start
      // scroll 会无限累加 1 / -1
      if (scroll < 0) {
        scroll = scroll % _p + _p
      }
      if (scroll > _p) {
        scroll = scroll % _p
      }
      const [sx, sy, sw, sh] = this.displacement(
        [cellWidth * slotIndex, scroll, cellWidth, h],
        [scroll, cellHeight * slotIndex, w, cellHeight]
      )
      const [dx, dy, dw, dh] = this.displacement(
        [x + widthAndSpacing * slotIndex, y, cellWidth, h],
        [x, y + heightAndSpacing * slotIndex, w, cellHeight]
      )
      this.drawImage(ctx, this._offscreenCanvas!, sx, sy, sw, sh, dx, dy, dw, dh)
    })
  }

  /**
   * 刻舟求剑
   */
  private carveOnGunwaleOfAMovingBoat (): void {
    const { _defaultConfig, prizeFlag, cellAndSpacing } = this
    // 记录开始停止的时间戳
    this.endTime = Date.now()
    this.slots.forEach((slot, slotIndex) => {
      const order = slot.order!
      if (!order.length) return
      const speed = slot.speed || _defaultConfig.speed
      const direction = slot.direction || _defaultConfig.direction
      const orderIndex = order.findIndex(prizeIndex => prizeIndex === prizeFlag)
      const _p = cellAndSpacing * order.length
      const stopScroll = this.stopScroll[slotIndex] = this.scroll[slotIndex]
      let i = 0
      while (++i) {
        const endScroll = cellAndSpacing * orderIndex + (_p * i * direction) - stopScroll
        const currSpeed = quad.easeOut(this.FPS, stopScroll, endScroll, _defaultConfig.decelerationTime) - stopScroll
        if (Math.abs(currSpeed) > speed) {
          this.endScroll[slotIndex] = endScroll
          break
        }
      }
    })
  }

  /**
   * 对外暴露: 开始抽奖方法
   */
   public play (): void {
    if (this.step !== 0) return
    // 记录开始游戏的时间
    this.startTime = Date.now()
    // 清空中奖索引
    this.prizeFlag = void 0
    // 开始加速
    this.step = 1
    // 开始渲染
    this.run()
  }

  public stop (index: number): void {
    if (this.step === 0 || this.step === 3) return
    // 设置中奖索引
    this.prizeFlag = index
    // 如果index是负数则停止游戏, 反之则传递中奖索引
    if (index < 0) {
      // 停止游戏
      this.step = 0
    } else {
      // 进入匀速
      this.step = 2
    }
  }

  /**
   * 让游戏动起来
   * @param num 记录帧动画执行多少次
   */
  private run (num: number = 0): void {
    const { rAF, step, prizeFlag, _defaultConfig, cellAndSpacing } = this
    const { accelerationTime, decelerationTime } = _defaultConfig
    // 游戏结束
    if (this.step === 0 && prizeFlag !== void 0 && prizeFlag >= 0) {
      this.endCallback?.(this.prizes.find((prize, index) => index === prizeFlag) || {})
      return
    }
    // 如果等于 -1 就直接停止游戏
    if (prizeFlag === -1) return
    // 计算最终停止的位置
    if (this.step === 3 && !this.endScroll.length) this.carveOnGunwaleOfAMovingBoat()
    // 计算时间间隔
    const startInterval = Date.now() - this.startTime
    const endInterval = Date.now() - this.endTime
    // 分别计算对应插槽的加速度
    this.slots.forEach((slot, slotIndex) => {
      const order = slot.order
      if (!order || !order.length) return
      const _p = cellAndSpacing * order.length
      const speed = Math.abs(slot.speed || _defaultConfig.speed)
      const direction = slot.direction || _defaultConfig.direction
      let scroll = 0, prevScroll = this.scroll[slotIndex]
      if (step === 1 || startInterval < accelerationTime) { // 加速阶段
        // 记录帧率
        this.FPS = startInterval / num
        const currSpeed = quad.easeIn(startInterval, 0, speed, accelerationTime)
        // 加速到最大速度后, 即可进入匀速阶段
        if (currSpeed === speed) {
          this.step = 2
        }
        scroll = (prevScroll + (currSpeed * direction)) % _p
      } else if (step === 2) { // 匀速阶段
        // 速度保持不变
        scroll = (prevScroll + (speed * direction)) % _p
        // 如果有 prizeFlag 有值, 则进入减速阶段
        if (prizeFlag !== void 0 && prizeFlag >= 0) {
          this.step = 3
          // 清空上一轮的位置信息
          this.stopScroll = []
          this.endScroll = []
        }
      } else if (step === 3 && endInterval) { // 减速阶段
        // 开始缓慢停止
        const stopScroll = this.stopScroll[slotIndex]
        const endScroll = this.endScroll[slotIndex]
        scroll = quad.easeOut(endInterval, stopScroll, endScroll, decelerationTime)
        if (endInterval >= decelerationTime) {
          this.step = 0
        }
      }
      this.scroll[slotIndex] = scroll
    })
    this.draw()
    rAF(this.run.bind(this, num + 1))
  }

  // 根据mode置换数值
  private displacement<T> (a: T, b: T): T {
    return this._defaultConfig.mode === 'horizontal' ? b : a
  }

  // 根据mode计算宽高
  private displacementWidthOrHeight () {
    const mode = this._defaultConfig.mode
    const slotsLen = this.slots.length
    const { colSpacing, rowSpacing } = this._defaultConfig
    const { x, y, w, h } = this.prizeArea || this.drawBlocks()!
    let cellWidth = 0, cellHeight = 0, widthAndSpacing = 0, heightAndSpacing = 0
    if (mode === 'horizontal') {
      cellHeight = this.cellHeight = (h - rowSpacing * (slotsLen - 1)) / slotsLen
      cellWidth = this.cellWidth = cellHeight
    } else {
      cellWidth = this.cellWidth = (w - colSpacing * (slotsLen - 1)) / slotsLen
      cellHeight = this.cellHeight = cellWidth
    }
    widthAndSpacing = this.widthAndSpacing = this.cellWidth + colSpacing
    heightAndSpacing = this.heightAndSpacing = this.cellHeight + rowSpacing
    if (mode === 'horizontal') {
      this.cellAndSpacing = widthAndSpacing
    } else {
      this.cellAndSpacing = heightAndSpacing
    }
    return {
      cellWidth,
      cellHeight,
      widthAndSpacing,
      heightAndSpacing,
    }
  }

  /**
   * 获取相对宽度
   * @param length 将要转换的宽度
   * @param width 宽度计算百分比
   * @return 返回相对宽度
   */
  private getWidth (
    length: string | number | undefined,
    width: number
  ): number {
    if (isExpectType(length, 'number')) return (length as number)
    if (isExpectType(length, 'string')) return this.changeUnits(length as string, width)
    return 0
  }

  /**
   * 转换并获取高度
   * @param height 将要转换的高度
   * @param row 纵向合并的格子
   * @return 返回相对高度
   */
  private getHeight (
    length: string | number | undefined,
    height: number
  ): number {
    if (isExpectType(length, 'number')) return (length as number)
    if (isExpectType(length, 'string')) return this.changeUnits(length as string, height)
    return 0
  }

  /**
   * 获取相对(居中)X坐标
   * @param width
   * @return 返回x坐标
   */
  private getOffsetX (width: number, maxWidth: number): number {
    return (maxWidth - width) / 2
  }
}
