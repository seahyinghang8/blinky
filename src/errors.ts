export class FormatError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class RuntimeError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ContextWindowExceededError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class CostLimitExceededError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class RetryError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InterruptError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
