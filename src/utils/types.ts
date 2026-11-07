export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Optional<T, K extends keyof T> = Omit<T, K> &
  Partial<T> &
  Record<string, unknown>;

export type Nullable<T> = {
  [P in keyof T]: T[P] | null;
};

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

export type Ok<T> = { ok: true; value: T };

export type Err<E> = { ok: false; error: E };

export type Result<T, E = Error> = Ok<T> | Err<E>;
