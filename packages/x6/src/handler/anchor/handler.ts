import * as util from '../../util'
import { Graph } from '../../graph'
import { View } from '../../core/view'
import { Model } from '../../core/model'
import { State } from '../../core/state'
import { Shape, ImageShape } from '../../shape'
import { BaseHandler } from '../handler-base'
import { Rectangle, Point, Anchor } from '../../struct'
import { DomEvent, MouseEventEx, Disposable } from '../../common'
import { getAnchorOptions, createAnchorHighlightShape } from './option'

export class AnchorHandler extends BaseHandler {
  inductionSize: number
  currentState: State | null
  currentPoint: Point | null
  currentArea: Rectangle | null
  currentAnchor: Anchor | null

  protected knobs: Shape[] | null
  protected points: Point[] | null
  protected anchors: Anchor[] | null
  protected highlight: Shape | null

  private resetHandler: (() => void) | null
  private containerEventInstalled = false

  constructor(graph: Graph) {
    super(graph)

    this.inductionSize = graph.options.anchor.inductionSize

    this.resetHandler = () => {
      if (
        this.currentState != null &&
        this.graph.view.getState(this.currentState.cell) == null
      ) {
        this.reset()
      } else {
        this.redraw()
      }
    }

    this.graph.on(Graph.events.root, this.resetHandler)
    this.graph.model.on(Model.events.change, this.resetHandler)
    this.graph.view.on(View.events.scale, this.resetHandler)
    this.graph.view.on(View.events.translate, this.resetHandler)
    this.graph.view.on(View.events.scaleAndTranslate, this.resetHandler)
  }

  reset() {
    this.destroyIcons()
    this.destroyHighlight()

    this.currentArea = null
    this.currentPoint = null
    this.currentState = null
    this.currentAnchor = null
  }

  redraw() {
    if (
      this.currentState != null &&
      this.anchors != null &&
      this.knobs != null &&
      this.points != null
    ) {
      const state = this.graph.view.getState(this.currentState.cell)!
      this.currentState = state
      this.currentArea = state.bounds.clone()

      for (let i = 0, ii = this.anchors.length; i < ii; i += 1) {
        const anchor = this.anchors[i]
        const point = this.graph.view.getConnectionPoint(state, anchor)!

        this.redrawAnchor(state, anchor, point, this.knobs[i])
        this.points[i] = point
        this.currentArea.add(this.knobs[i].bounds)
      }
    }
  }

  protected redrawAnchor(
    state: State,
    anchor: Anchor,
    point: Point,
    icon?: Shape,
  ) {
    const { image, cursor, className } = getAnchorOptions({
      anchor,
      point,
      graph: this.graph,
      cell: state.cell,
    })

    const bounds = new Rectangle(
      Math.round(point.x - image.width / 2),
      Math.round(point.y - image.height / 2),
      image.width,
      image.height,
    )

    if (icon == null) {
      const img = new ImageShape(bounds, image.src)
      img.dialect = 'svg'
      img.preserveImageAspect = false
      img.init(this.graph.view.getDecoratorPane())
      util.toBack(img.elem)

      icon = img // tslint:disable-line
      const getState = () => this.currentState || state
      MouseEventEx.redirectMouseEvents(icon.elem, this.graph, getState)
    }

    util.applyClassName(icon, this.graph.prefixCls, 'anchor', className)

    icon.image = image.src
    icon.bounds = bounds
    icon.cursor = cursor

    icon.redraw()

    return icon
  }

  protected getTolerance(e: MouseEventEx) {
    return this.graph.tolerance
  }

  protected isEventIgnored(e: MouseEventEx) {
    return false
  }

  protected isStateIgnored(state: State, isSource: boolean) {
    return false
  }

  /**
   * Returns true if the current focused state should not be changed
   * for the given event.
   *
   * This implementation returns true if shift is pressed.
   */
  protected isKeepFocusEvent(e: MouseEventEx) {
    return DomEvent.isShiftDown(e.getEvent())
  }

  protected getAnchors(state: State, isSource: boolean) {
    if (
      this.isEnabled() &&
      state != null &&
      !this.isStateIgnored(state, isSource) &&
      this.graph.isCellConnectable(state.cell)
    ) {
      const items = this.graph.getAnchors(state.cell, isSource)
      if (items != null) {
        return items.map(item => {
          if (item instanceof Anchor) {
            return item
          }
          return new Anchor(item)
        })
      }
    }

    return null
  }

  protected getCell(e: MouseEventEx, point: Point | null) {
    let cell = e.getCell()

    // Gets cell under actual point if different from event location
    if (
      cell == null &&
      point != null &&
      (e.getGraphX() !== point.x || e.getGraphY() !== point.y)
    ) {
      cell = this.graph.getCellAt(point.x, point.y)
    }

    // Uses connectable parent node if one exists
    if (cell != null && !this.graph.isCellConnectable(cell)) {
      const parent = this.graph.getModel().getParent(cell)

      if (
        this.graph.model.isNode(parent) &&
        this.graph.isCellConnectable(parent)
      ) {
        cell = parent
      }
    }

    return this.graph.isCellLocked(cell) ? null : cell
  }

  update(
    e: MouseEventEx,
    isSource: boolean,
    existingEdge: boolean,
    currentPoint: Point | null,
  ) {
    if (this.isEnabled() && !this.isEventIgnored(e)) {
      if (!this.containerEventInstalled && this.graph.container) {
        DomEvent.addListener(
          this.graph.container,
          'mouseleave',
          this.resetHandler!,
        )
      }

      const graphX = e.getGraphX()
      const graphY = e.getGraphY()
      const tol = this.getTolerance(e)
      const x = currentPoint != null ? currentPoint.x : graphX
      const y = currentPoint != null ? currentPoint.y : graphY
      const grid = new Rectangle(x - tol, y - tol, 2 * tol, 2 * tol)
      const mouse = new Rectangle(graphX - tol, graphY - tol, 2 * tol, 2 * tol)
      const state = this.graph.view.getState(this.getCell(e, currentPoint))

      // Keeps focus icons visible while over node bounds and
      // no other cell under mouse or shift is pressed
      if (
        !this.isKeepFocusEvent(e) &&
        (this.currentState == null ||
          this.currentArea == null ||
          state != null ||
          !this.graph.model.isNode(this.currentState.cell) ||
          !this.currentArea.isIntersectWith(mouse)) &&
        state !== this.currentState
      ) {
        this.currentArea = null
        this.currentState = null
        this.focus(e, state!, isSource)
      }

      this.currentPoint = null
      this.currentAnchor = null

      // highlight hovering anchor
      if (
        this.knobs != null &&
        this.points != null &&
        this.anchors != null &&
        (state == null || this.currentState === state)
      ) {
        // console.log('highlight hovering anchor')
        let bounds: Rectangle | null = null
        let minDist: number | null = null

        for (let i = 0, ii = this.knobs.length; i < ii; i += 1) {
          const dx = graphX - this.knobs[i].bounds.getCenterX()
          const dy = graphY - this.knobs[i].bounds.getCenterY()
          const dis = dx * dx + dy * dy
          // console.log(dx, dy, dis)
          if (
            (Math.sqrt(dis) < this.inductionSize ||
              this.intersects(this.knobs[i], mouse) ||
              (currentPoint != null && this.intersects(this.knobs[i], grid))) &&
            (minDist == null || dis < minDist)
          ) {
            this.currentPoint = this.points[i]
            this.currentAnchor = this.anchors[i]
            minDist = dis
            bounds = this.knobs[i].bounds.clone()

            if (this.highlight == null) {
              this.highlight = this.createHighlightShape(state)
            }
          }
        }

        if (bounds != null && this.highlight != null) {
          this.highlight.bounds = bounds
          this.highlight.redraw()
        }
      }

      if (this.currentAnchor == null) {
        this.destroyHighlight()
      }
    } else {
      this.currentState = null
      this.currentPoint = null
      this.currentAnchor = null
    }
  }

  focus(e: MouseEventEx, state: State, isSource: boolean) {
    this.anchors = this.getAnchors(state, isSource)

    if (this.anchors != null) {
      this.currentState = state
      this.currentArea = state.bounds.clone()

      this.destroyIcons()

      this.knobs = []
      this.points = []

      for (let i = 0, ii = this.anchors.length; i < ii; i += 1) {
        const c = this.anchors[i]
        const p = this.graph.view.getConnectionPoint(state, c)!
        const icon = this.redrawAnchor(state, c, p)
        this.knobs.push(icon)
        this.points.push(p)
        this.currentArea.add(icon.bounds)
      }

      this.currentArea.grow(this.getTolerance(e))
    } else {
      this.destroyIcons()
      this.destroyHighlight()
    }
  }

  protected createHighlightShape(state: State | null) {
    const s = (this.currentState || state)!
    const shape = createAnchorHighlightShape({
      graph: this.graph,
      cell: s.cell,
    })

    shape.init(this.graph.view.getOverlayPane())
    const getState = () => (this.currentState || state) as State
    MouseEventEx.redirectMouseEvents(shape.elem, this.graph, getState)

    return shape
  }

  protected intersects(icon: Shape, mouse: Rectangle) {
    return icon.bounds.isIntersectWith(mouse)
  }

  protected destroyIcons() {
    if (this.knobs != null) {
      this.knobs.forEach(i => i.dispose())
      this.knobs = null
      this.points = null
    }
  }

  protected destroyHighlight() {
    if (this.highlight) {
      this.highlight.dispose()
      this.highlight = null
    }
  }

  @Disposable.aop()
  dispose() {
    this.reset()

    if (this.resetHandler != null) {
      this.graph.off(null, this.resetHandler)
      this.graph.model.off(null, this.resetHandler)
      this.graph.view.off(null, this.resetHandler)

      if (this.containerEventInstalled && this.graph.container) {
        DomEvent.removeListener(
          this.graph.container,
          'mouseleave',
          this.resetHandler,
        )
      }

      this.resetHandler = null
    }
  }
}
