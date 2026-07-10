export interface Pos {
  line: number;
  col: number;
}

export class DslError extends Error {
  pos?: Pos;

  constructor(message: string, pos?: Pos) {
    super(pos ? `${message} (line ${pos.line}, col ${pos.col})` : message);
    this.pos = pos;
  }
}
