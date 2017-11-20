import * as Rx from "rxjs";
import { PartialObserver } from "rxjs/Observer";

export class PromiseStream<T> implements PromiseLike<T[]>  {
	public do = this.peek;
	public all = this.collect;
	public take = this.limit;

	private observed: Rx.Observable<T>;

	private constructor(observable: Rx.Observable<T>) {
		this.observed = observable;
	}

	public static from<R>(unknown: Rx.Observable<R> | Array<PromiseLike<R>> | Promise<R[]> | R[] | R): PromiseStream<R> {
		if (unknown instanceof Rx.Observable) {
			return PromiseStream.fromObservable(unknown);
		}

		if (PromiseStream.isPromise<R[]>(unknown)) {
			return PromiseStream.fromPromise(unknown);
		}

		if (unknown instanceof Array) {
			return PromiseStream.fromArray(unknown);
		}

		return new PromiseStream(Rx.Observable.of(unknown));
	}

	public static fromObservable<R>(observable: Rx.Observable<R>): PromiseStream<R> {
		return new PromiseStream(observable);
	}

	public static fromArray<R>(array: Array<PromiseLike<R>> | R[]): PromiseStream<R> {
		const observable = Rx.Observable.from<R>(array as R[]).mergeMap((p: R) => {
			if (PromiseStream.isPromise<R>(p)) {
				return p;
			} else {
				return [p];
			}
		});

		return new PromiseStream<R>(observable);
	}

	public static fromPromise<R>(promiseArray: PromiseLike<R | R[]>): PromiseStream<R> {
		return new PromiseStream(Rx.Observable.fromPromise(promiseArray).mergeMap((array: R | R[]) => array instanceof Array ? array : [array]));
	}

	private static isPromise<R>(value: any): value is PromiseLike<R> {
		return typeof value.then === "function";
	}

	public map<R>(callback: (value: T) => R | PromiseLike<R>): PromiseStream<R> {
		const observable = this.observed.mergeMap((value: T) => {
			const promiseOrValue = callback(value);

			if (PromiseStream.isPromise(promiseOrValue)) {
				return Rx.Observable.fromPromise(promiseOrValue);
			} else {
				return [promiseOrValue];
			}
		});

		return PromiseStream.fromObservable(observable);
	}

	public filter(callback: (value: T) => boolean | PromiseLike<boolean>): PromiseStream<T> {
		const observable = Rx.Observable.create((observer: Rx.Observer<T>) => {
			this.observed.forEach((value: T) => {
				const promiseOrBoolean = callback(value);

				if (!promiseOrBoolean) return;

				if (PromiseStream.isPromise<T>(promiseOrBoolean)) {
					return promiseOrBoolean.then((bool) => {
						if (bool) {
							observer.next(value);
						}
					});
				}

				observer.next(value);
			}).then(() => observer.complete(), (e) => observer.error(e));
		});

		return PromiseStream.fromObservable(observable);
	}

	public flatten(): PromiseStream<T> {
		const observable = this.observed.mergeMap((value: T | T[]) => value instanceof Array ? value : [value]);

		return PromiseStream.fromObservable(observable);
	}

	public flatMap<R>(callback: (value: T) => R[] | R | PromiseLike<R | R[]>): PromiseStream<R> {
		const observable = this.observed.mergeMap((value: T) => {
			const promiseOrArrayOrValue = callback(value);

			if (PromiseStream.isPromise(promiseOrArrayOrValue)) {
				return Rx.Observable.fromPromise(promiseOrArrayOrValue as PromiseLike<R>).mergeMap((array: R | R[]) => array instanceof Array ? array : [array]);
			}

			if (promiseOrArrayOrValue instanceof Array) {
				return promiseOrArrayOrValue;
			}

			return [promiseOrArrayOrValue];

		});

		return PromiseStream.fromObservable(observable);
	}

	public concat(concatable: PromiseStream<T> | Array<PromiseLike<T>> | PromiseLike<T[]> | Rx.Observable<T> | T[]): PromiseStream<T> {
		if (PromiseStream.isPromise<T>(concatable) || concatable instanceof Array) {
			concatable = PromiseStream.from(concatable);
		}

		return PromiseStream.fromObservable(this.observed.merge(concatable));
	}

	public some(matchCallback: (value: T) => boolean | PromiseLike<boolean>): Promise<boolean> {
		let resolved = false;

		return new Promise((resolve, reject) => {
			const subscription = this.observed.subscribe((value: T) => {
				if (resolved) { return; }

				const result = matchCallback(value);

				if (PromiseStream.isPromise(result)) {
					return result.then((doesMatch) => {
						if (doesMatch) {
							resolve(true);
							resolved = true;
							subscription.unsubscribe();
						}
					});
				}

				if (result) {
					resolve(true);
					resolved = true;
					subscription.unsubscribe();
				}
			}, (e) => reject(e), () => resolved || resolve(false));
		});
	}

	public every(matchCallback: (value: T) => boolean | PromiseLike<boolean>): Promise<boolean> {
		let resolved = false;

		return new Promise((resolve, reject) => {
			const subscription = this.observed.subscribe((value: T) => {
				if (resolved) { return; }

				const result = matchCallback(value);

				if (PromiseStream.isPromise(result)) {
					return result.then((doesMatch) => {
						if (!doesMatch) {
							resolve(false);
							resolved = true;
							subscription.unsubscribe();
						}
					});
				}

				if (!result) {
					resolve(false);
					resolved = true;
					subscription.unsubscribe();
				}
			}, (e) => reject(e), () => resolved || resolve(true));
		});
	}

	public find(matchCallback: (value: T) => boolean | PromiseLike<boolean>): Promise<T | null> {
		let resolved = false;

		return new Promise((resolve, reject) => {
			const subscription = this.observed.subscribe((value: T) => {
				if (resolved) { return; }

				const result = matchCallback(value);

				if (PromiseStream.isPromise(result)) {
					return result.then((doesMatch) => {
						if (doesMatch && !resolved) {
							resolve(value);
							resolved = true;
							subscription.unsubscribe();
						}
					});
				}

				if (result) {
					resolve(value);
					resolved = true;
					subscription.unsubscribe();
				}
			}, (e) => reject(e), () => resolved || resolve(null));
		});
	}

	public reduce<R>(callback: (accumulator: R, currentValue: T) => R | Promise<R>, initialValue: R | PromiseLike<R>): Promise<R> {
		let accumulator: Promise<R> = Promise.resolve(initialValue);

		return this.observed.forEach((value: T) => {
			accumulator = accumulator.then((result) => callback(result, value));
		}).then(() => accumulator);
	}

	public distinct(): PromiseStream<T> {
		return new PromiseStream(this.observed.distinct());
	}

	public min(comparator: (a: T, b: T) => number): Promise<T> {
		return this.observed.min(comparator).toPromise();
	}

	public max(comparator: (a: T, b: T) => number): Promise<T> {
		return this.observed.max(comparator).toPromise();
	}

	public sum(adder: (a: T, b: T) => T): Promise<T> {
		return this.observed.first().toPromise().then((first: T) => {
			return new PromiseStream<T>(this.observed.skip(1)).reduce(adder, first);
		});
	}

	public count(): Promise<number> {
		return this.observed.count().toPromise();
	}

	public limit(maxElements: number): PromiseStream<T> {
		return new PromiseStream(this.observed.take(maxElements));
	}

	public collect(): Promise<T[]> {
		const values: T[] = [];
		return this.observed.forEach((v: T) => values.push(v)).then(() => values);
	}

	public forEach(callback: (value: T) => any): Promise<void> {
		return this.observed.forEach(callback);
	}

	public peek(callback: (value: T) => any): this {
		this.forEach(callback);
		return this;
	}

	public observable(): Rx.Observable<T> {
		return this.observed;
	}

	public subscribe(): Rx.Subscription;
	public subscribe(observer: PartialObserver<T>): Rx.Subscription;
	public subscribe(next?: (value: T) => void, error?: (error: any) => void, complete?: () => void): Rx.Subscription;
	public subscribe(next?: any, error?: (error: any) => void, complete?: () => void): Rx.Subscription {
		return this.observed.subscribe(next, error, complete);
	}

	public then<TResult1 = T[], TResult2 = never>(onfulfilled?: ((values: T[]) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
		return this.collect().then(onfulfilled, onrejected);
	}

	public catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T[] | TResult> {
		return this.collect().catch(onrejected);
	}
}
