"""Deterministic spec-to-PNG renderer for Mint chat plots.

Reads one JSON spec from stdin, writes one PNG to stdout. There is no
expression `eval`: equation strings walk an AST with a whitelist of node
types, functions, and constants, so nothing model-written can execute.
"""

import ast
import io
import json
import math
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

MAX_EXPR_CHARS = 300
MAX_SAMPLES = 2000
MIN_SAMPLES = 32
DEFAULT_SAMPLES = 400
MAX_EQUATIONS = 6
MAX_SERIES = 8
MAX_SERIES_POINTS = 500
MAX_DATA_POINTS = 2000
MAX_CATEGORIES = 24
MAX_BINS = 100
MAX_TEXT = 120


class SpecError(Exception):
    pass


DARK = {
    'figure': '#171813',
    'axes': '#1e201a',
    'text': '#ecefe6',
    'muted': '#a3a794',
    'grid': (0.925, 0.937, 0.902, 0.07),
    'series': ['#86d95f', '#8fb8dd', '#e3b469', '#a3a8e0', '#46bda2', '#e0715e', '#c0b3ec', '#e3c46a'],
}
LIGHT = {
    'figure': '#ffffff',
    'axes': '#fdfdfb',
    'text': '#1a1a18',
    'muted': '#61615a',
    'grid': (0.102, 0.102, 0.094, 0.08),
    'series': ['#3f7a12', '#2a6fb8', '#9a6a10', '#5d51b0', '#2c8f76', '#c2402f', '#6f55a0', '#8a5a0a'],
}

FUNC_TABLE = {
    'sin': np.sin, 'cos': np.cos, 'tan': np.tan,
    'asin': np.arcsin, 'acos': np.arccos, 'atan': np.arctan,
    'sinh': np.sinh, 'cosh': np.cosh, 'tanh': np.tanh,
    'exp': np.exp, 'log': np.log, 'log2': np.log2, 'log10': np.log10,
    'sqrt': np.sqrt, 'abs': np.abs, 'floor': np.floor, 'ceil': np.ceil,
    'min': np.minimum, 'max': np.maximum, 'pow': np.power,
}
CONSTANTS = {'pi': np.pi, 'e': np.e, 'tau': math.tau}

X = None  # bound per-evaluation by eval_program


def eval_node(node):
    if isinstance(node, ast.Expression):
        return eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise SpecError('Only plain numbers are allowed in expressions.')
        if not math.isfinite(node.value):
            raise SpecError('Numbers in expressions must be finite.')
        return node.value
    if isinstance(node, ast.Name):
        if node.id == 'x':
            return X
        if node.id in CONSTANTS:
            return CONSTANTS[node.id]
        raise SpecError(f'Unknown name "{node.id}". Use x, pi, e, or tau.')
    if isinstance(node, ast.BinOp):
        left, right = eval_node(node.left), eval_node(node.right)
        with np.errstate(all='ignore'):
            try:
                if isinstance(node.op, ast.Add):
                    return left + right
                if isinstance(node.op, ast.Sub):
                    return left - right
                if isinstance(node.op, ast.Mult):
                    return left * right
                if isinstance(node.op, ast.Div):
                    return left / right
                if isinstance(node.op, ast.FloorDiv):
                    return left // right
                if isinstance(node.op, ast.Mod):
                    return left % right
                if isinstance(node.op, ast.Pow):
                    return np.power(left, right)
            except (OverflowError, ValueError, ZeroDivisionError, FloatingPointError):
                raise SpecError('The expression overflowed.')
        raise SpecError('Unsupported operator in expression.')
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, ast.USub):
            return -eval_node(node.operand)
        if isinstance(node.op, ast.UAdd):
            return eval_node(node.operand)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise SpecError('Only direct calls to whitelisted functions are allowed.')
        fn = FUNC_TABLE.get(node.func.id)
        if fn is None:
            raise SpecError(f'Function "{node.func.id}" is not allowed.')
        if node.keywords:
            raise SpecError('Keyword arguments are not allowed in expressions.')
        args = [eval_node(arg) for arg in node.args]
        if len(args) > 3:
            raise SpecError('Too many arguments in expression.')
        with np.errstate(all='ignore'):
            try:
                return fn(*args)
            except Exception:
                raise SpecError(f'Could not evaluate {node.func.id}(…).')
    raise SpecError('Unsupported syntax in expression.')


def eval_equation(expr, x):
    global X
    X = x
    # User-facing notation is ^ for powers; normalize before parsing so the
    # Python grammar sees ** (models routinely emit either).
    expr = expr.replace('^', '**')
    try:
        tree = ast.parse(expr, mode='eval')
    except SyntaxError:
        raise SpecError('The equation is not valid math syntax.')
    y = eval_node(tree)
    y = np.asarray(y, dtype='float64')
    if y.shape == ():
        y = np.full_like(x, float(y))
    if y.shape != x.shape:
        raise SpecError('The equation must produce one value per x.')
    return np.where(np.isfinite(y), y, np.nan)


def numbers(values, field, minimum=0, maximum=MAX_SERIES_POINTS):
    if not isinstance(values, list):
        raise SpecError(f'"{field}" must be a list.')
    if len(values) < minimum or len(values) > maximum:
        raise SpecError(f'"{field}" must have {minimum}-{maximum} entries.')
    out = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SpecError(f'"{field}" must contain plain numbers.')
        if not math.isfinite(value):
            raise SpecError(f'"{field}" must contain finite numbers.')
        out.append(float(value))
    return out


def labels(values, field, maximum=MAX_CATEGORIES):
    if not isinstance(values, list) or len(values) == 0 or len(values) > maximum:
        raise SpecError(f'"{field}" must be a list of 1-{maximum} entries.')
    out = []
    for value in values:
        if not isinstance(value, str) or not value.strip():
            raise SpecError(f'"{field}" must contain non-empty text labels.')
        out.append(value.strip()[:40])
    return out


def text(value, field):
    if value is None:
        return ''
    if not isinstance(value, str):
        raise SpecError(f'"{field}" must be text.')
    return value.strip()[:MAX_TEXT]


def number_choice(value, fallback, lo, hi):
    if value is None:
        return fallback
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SpecError('Expected a finite number.')
    return min(hi, max(lo, float(value)))


def spec_floats(value, field):
    number = number_choice(value, None, -1e12, 1e12)
    if number is None:
        raise SpecError(f'"{field}" must be a number.')
    return number


def main():
    raw = sys.stdin.read(32769)
    try:
        spec = json.loads(raw)
    except Exception:
        raise SpecError('The plot spec must be valid JSON.')
    if not isinstance(spec, dict):
        raise SpecError('The plot spec must be a JSON object.')

    chart = spec.get('chart', 'line')
    if not isinstance(chart, str):
        raise SpecError('"chart" must be text.')
    chart = chart.strip().lower()
    if chart not in {'line', 'scatter', 'bar', 'histogram'}:
        raise SpecError('"chart" must be one of line, scatter, bar, histogram.')

    palette = DARK if spec.get('theme') != 'light' else LIGHT
    title = text(spec.get('title'), 'title')
    x_label = text(spec.get('xLabel'), 'xLabel')
    y_label = text(spec.get('yLabel'), 'yLabel')
    log_x = bool(spec.get('logX'))
    log_y = bool(spec.get('logY'))
    show_grid = spec.get('grid') is not False

    fig, ax = plt.subplots(figsize=(8.6, 4.8), dpi=130)
    fig.patch.set_facecolor(palette['figure'])
    ax.set_facecolor(palette['axes'])

    drawn = 0

    if chart in {'line', 'scatter'}:
        x_range = spec.get('xRange', [-10, 10])
        if not isinstance(x_range, list) or len(x_range) != 2:
            raise SpecError('"xRange" must be [min, max].')
        x_min, x_max = spec_floats(x_range[0], 'xRange[0]'), spec_floats(x_range[1], 'xRange[1]')
        if not x_min < x_max:
            raise SpecError('"xRange[0]" must be smaller than "xRange[1]".')
        samples = int(number_choice(spec.get('samples'), DEFAULT_SAMPLES, MIN_SAMPLES, MAX_SAMPLES))
        x = np.linspace(x_min, x_max, samples)

        equations = spec.get('equations', [])
        if not isinstance(equations, list):
            raise SpecError('"equations" must be a list.')
        if len(equations) > MAX_EQUATIONS:
            raise SpecError(f'At most {MAX_EQUATIONS} equations can be plotted.')
        for index, item in enumerate(equations):
            if not isinstance(item, dict):
                raise SpecError('Each equation must be an object with an "expr" string.')
            expr = item.get('expr')
            if not isinstance(expr, str):
                raise SpecError('Each equation needs an "expr" string.')
            expr = expr.strip()
            if not expr or len(expr) > MAX_EXPR_CHARS:
                raise SpecError(f'Equations must be 1-{MAX_EXPR_CHARS} characters.')
            label = text(item.get('label'), 'label') or expr
            y = eval_equation(expr, x)
            color = palette['series'][drawn % len(palette['series'])]
            if chart == 'scatter':
                ax.scatter(x, y, s=9, label=label, color=color, zorder=3)
            else:
                ax.plot(x, y, linewidth=2, label=label, color=color, zorder=3)
            drawn += 1

        series = spec.get('series', [])
        if not isinstance(series, list):
            raise SpecError('"series" must be a list.')
        if len(series) > MAX_SERIES:
            raise SpecError(f'At most {MAX_SERIES} series can be plotted.')
        for index, item in enumerate(series):
            if not isinstance(item, dict):
                raise SpecError('Each series must be an object with "x" and "y" lists.')
            xs = numbers(item.get('x'), f'series[{index}].x', minimum=1, maximum=MAX_SERIES_POINTS)
            ys = numbers(item.get('y'), f'series[{index}].y', minimum=1, maximum=MAX_SERIES_POINTS)
            if len(xs) != len(ys):
                raise SpecError('Series "x" and "y" must have the same length.')
            label = text(item.get('label'), 'label') or f'Series {drawn + 1}'
            color = palette['series'][drawn % len(palette['series'])]
            if chart == 'scatter':
                ax.scatter(xs, ys, s=14, label=label, color=color, zorder=3)
            else:
                ax.plot(xs, ys, linewidth=2, marker='o', markersize=3.5, label=label, color=color, zorder=3)
            drawn += 1

        if drawn == 0:
            raise SpecError('Nothing to plot: add "equations" or "series".')

    elif chart == 'bar':
        series = spec.get('series')
        if not isinstance(series, list) or len(series) < 1:
            raise SpecError('Chart "bar" needs one series with "x" labels and "y" values.')
        item = series[0]
        if not isinstance(item, dict):
            raise SpecError('The bar series must be an object with "x" and "y" lists.')
        xs = item.get('x')
        if isinstance(xs, list) and xs and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in xs):
            cats = [str(v) for v in numbers(xs, 'series[0].x', minimum=1, maximum=MAX_CATEGORIES)]
        else:
            cats = labels(xs, 'series[0].x')
        ys = numbers(item.get('y'), 'series[0].y', minimum=1, maximum=MAX_CATEGORIES)
        if len(cats) != len(ys):
            raise SpecError('Bar "x" and "y" must have the same length.')
        label = text(item.get('label'), 'label')
        ax.bar(cats, ys, width=0.68, color=palette['series'][0], label=label or None, zorder=3)
        drawn += 1

    elif chart == 'histogram':
        data = numbers(spec.get('data'), 'data', minimum=1, maximum=MAX_DATA_POINTS)
        bins = int(number_choice(spec.get('bins'), 20, 4, MAX_BINS))
        label = text(spec.get('label'), 'label')
        ax.hist(data, bins=bins, color=palette['series'][0], alpha=0.9, label=label or None, zorder=3)
        drawn += 1

    if log_x:
        ax.set_xscale('log')
    if log_y:
        ax.set_yscale('log')
    if title:
        ax.set_title(title, fontsize=12.5, fontweight='semibold', color=palette['text'], pad=12)
    if x_label:
        ax.set_xlabel(x_label, fontsize=10, color=palette['muted'])
    if y_label:
        ax.set_ylabel(y_label, fontsize=10, color=palette['muted'])

    ax.tick_params(axis='both', colors=palette['muted'], labelsize=9)
    for spine in ('top', 'right'):
        ax.spines[spine].set_visible(False)
    for spine in ('left', 'bottom'):
        ax.spines[spine].set_color(palette['grid'])
    if show_grid:
        ax.grid(True, color=palette['grid'], linewidth=0.9, zorder=0)

    handles, _ = ax.get_legend_handles_labels()
    if any(h.get_label() and not h.get_label().startswith('_') for h in handles):
        ax.legend(frameon=False, fontsize=9, labelcolor=palette['text'], loc='best')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', facecolor=palette['figure'])
    plt.close(fig)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    try:
        main()
    except SpecError as exc:
        sys.stderr.write(str(exc))
        sys.exit(2)
    except Exception:
        sys.stderr.write('Renderer could not draw this spec.')
        sys.exit(3)
