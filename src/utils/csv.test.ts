import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers and rows with commas and newlines', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\n1,2\n3,4\n');
  });

  it('quotes cells containing commas', () => {
    expect(toCsv(['x'], [['hello, world']])).toBe('x\n"hello, world"\n');
  });

  it('doubles embedded quotes and quotes the cell', () => {
    expect(toCsv(['x'], [['say "hi"']])).toBe('x\n"say ""hi"""\n');
  });

  it('quotes cells containing newlines', () => {
    expect(toCsv(['x'], [['line1\nline2']])).toBe('x\n"line1\nline2"\n');
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, 0]])).toBe('a,b,c\n,,0\n');
  });
});
