/**
 * Created by Samuel Gratzl on 26.01.2016.
 */

import './style.scss';
import * as d3 from 'd3';
import {onDOMNodeRemoved, mixin} from 'phovea_core/src';
import {Range} from 'phovea_core/src/range';
import {AVisInstance, IVisInstance, assignVis, ITransform} from 'phovea_core/src/vis';
import {IHistAbleDataType} from 'phovea_core/src/datatype';
import {IStratification} from 'phovea_core/src/stratification';
import {ICatHistogram} from 'phovea_core/src/math';
import {toSelectOperation} from 'phovea_core/src/idtype';
import {vec2, polygon} from 'phovea_core/src/geom';
import bindTooltip from 'phovea_d3/src/tooltip';
import {IDistributionOptions, ITotalHeight, resolveHistMax} from './utils';


function toPolygon(start: number, end: number, radius: number) {
  const r = [
    vec2(radius, radius),
    vec2(radius + Math.cos(start) * radius, radius + Math.sin(start) * radius),
    vec2(radius + Math.cos(end) * radius, radius + Math.sin(end) * radius)
  ];
  //approximate by triangle
  if (end - start > Math.PI) { //more than 180 degree use one more point
    r.splice(2, 0, vec2(radius + Math.cos((end - start) * 0.5) * radius, radius + Math.sin((end - start) * 0.5) * radius));
  }
  return polygon(r);
}

interface IRadialHistData {
  name: string;
  start: number;
  size: number;
  ratio: number;
  end: number;
  color: string;
  range: Range;
}

interface IRadialHistHelper {
  start: number;
  end: number;
}

export interface IPieOptions extends IDistributionOptions {
  /**
   * options to specify how the total value is computed
   * @default true
   */
  total?: ITotalHeight;

  /**
   * @default 200
   */
  duration?: number;

  /**
   * @default 50
   */
  radius?: number;
  /**
   * @default 0
   */
  innerRadius?: number;
}

export default class Pie extends AVisInstance implements IVisInstance {
  private readonly options: IPieOptions = {
    radius: 50,
    innerRadius: 0,
    duration: 200,
    total: true,
    scale: [1, 1],
    rotate: 0
  };

  private readonly $node: d3.Selection<Pie>;

  private scale: d3.scale.Linear<number, number>;
  private arc: d3.svg.Arc<IRadialHistHelper>;

  private hist: ICatHistogram;
  private hist_data: IRadialHistData[];

  constructor(public readonly data: IHistAbleDataType|IStratification, parent: Element, options: IPieOptions = {}) {
    super();
    mixin(this.options, options);

    this.$node = this.build(d3.select(parent));
    this.$node.datum(this);
    assignVis(this.node, this);
  }

  get rawSize(): [number, number] {
    const r = this.options.radius;
    return [r * 2, r * 2];
  }

  get node() {
    return <Element>this.$node.node();
  }

  private build($parent: d3.Selection<any>) {
    const size = this.size,
      data = this.data,
      o = this.options;

    const $svg = $parent.append('svg').attr({
      width: size[0],
      height: size[1],
      'class': 'phovea-pie'
    });
    const $base = $svg.append('g').attr('transform', 'translate(' + o.radius + ',' + o.radius + ')');
    const $data = $base.append('g');
    const $highlight = $base.append('g').style('pointer-events', 'none').classed('phovea-select-selected', true);

    const scale = this.scale = d3.scale.linear().range([0, 2 * Math.PI]);
    const arc = this.arc = d3.svg.arc<IRadialHistData>().innerRadius(o.innerRadius).outerRadius(o.radius)
      .startAngle((d) => scale(d.start))
      .endAngle((d) => scale(d.end));

    const l = (event, type, selected) => {
      if (!this.hist_data) {
        return;
      }
      const highlights = this.hist_data.map((entry) => {
        const s = entry.range.intersect(selected);
        return {
          start: entry.start,
          end: entry.start + s.size()[0]
        };
      }).filter((entry) => entry.start < entry.end);
      const $m = $highlight.selectAll('path').data(highlights);
      $m.enter().append('path');
      $m.exit().remove();
      $m.attr('d', arc);
    };
    data.on('select', l);
    onDOMNodeRemoved(<Element>$data.node(), function () {
      data.off('select', l);
    });

    data.hist().then((hist) => {
      this.hist = <ICatHistogram>hist;
      return resolveHistMax(hist, this.options.total);
    }).then((total) => {
      const hist = this.hist;
      scale.domain([0, total]);
      const hist_data = this.hist_data = [], cats: any[] = hist.categories;
      let prev = 0;

      const cols = hist.colors || d3.scale.category10().range();
      hist.forEach(function (b, i) {
        hist_data[i] = {
          name: (typeof cats[i] === 'string') ? cats[i] : cats[i].name,
          start: prev,
          size: b,
          ratio: b / total,
          end: prev + b,
          color: (cats[i].color === undefined) ? cols[i] : cats[i].color,
          range: hist.range(i)
        };
        prev += b;
      });
      const $m = $data.selectAll('path').data(hist_data);
      $m.enter()
        .append('path')
        .call(bindTooltip<IRadialHistData>((d) => d.name + ' ' + (d.size) + ' entries (' + Math.round(d.ratio * 100) + '%)'))
        .on('click', (d) => data.select(0, d.range, toSelectOperation(d3.event)));
      $m.attr('d', arc)
        .attr('fill', (d) => d.color)
        .style('opacity', 0);
      //fade in animation
      $m.transition()
        .duration(o.duration)
        .delay((d, i) => i * o.duration)
        .style('opacity', 1);

      this.markReady();
      data.selections().then((selected) => l(null, 'selected', selected));
    });
    return $svg;
  }

  locateImpl(range: Range) {
    const o = this.options;
    if (range.isAll || range.isNone) {
      return Promise.resolve({x: o.radius, y: o.radius, radius: o.radius});
    }
    return (<any>this.data).data(range).then((data) => {
      const ex = d3.extent(data, (value) => this.hist.binOf(value));
      const startAngle = this.scale(this.hist_data[ex[0]].start);
      const endAngle = this.scale(this.hist_data[ex[1]].end);
      return Promise.resolve(toPolygon(startAngle, endAngle, o.radius));
    });
  }

  transform(scale?: [number, number], rotate?: number): ITransform {
    const bak = {
      scale: this.options.scale || [1, 1],
      rotate: this.options.rotate || 0
    };
    if (arguments.length === 0) {
      return bak;
    }
    this.$node.attr({
      width: this.options.radius * 2 * scale[0],
      height: this.options.radius * 2 * scale[1]
    }).style('transform', 'rotate(' + rotate + 'deg)');
    this.$node.select('g').attr('transform', 'scale(' + scale[0] + ',' + scale[1] + ')translate(' + this.options.radius + ',' + this.options.radius + ')');

    const new_ = {
      scale: scale,
      rotate: rotate
    };
    this.fire('transform', new_, bak);
    this.options.scale = scale;
    this.options.rotate = rotate;
    return new_;
  }


  //updatedOption (name, value) {
  //  if (name === 'innerRadius' || name === 'radius' || name === 'total') {
  //    this.updateVis();
  //  }
  //}
  //private updateVis() {
  //  const o = this.options;
  //  this.arc.innerRadius(o.innerRadius).outerRadius(o.radius);
  //  this.scale.domain([0, o.total || this.hist.count]);
  //
  //  this.$node.selectAll('path').transition().attr('d', this.arc);
  //}
}

export function create(data: IHistAbleDataType|IStratification, parent: Element, options?: IPieOptions) {
  return new Pie(data, parent, options);
}
