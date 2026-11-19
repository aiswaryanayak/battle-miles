export type PackageCode = '05' | '10' | '20';

export const registrationPackages: Record<PackageCode, {
  distanceKm: number;
  amountPaise: number;
  inclusions: string[];
}> = {
  '05': {
    distanceKm: 5,
    amountPaise: 80000,
    inclusions: ['medal', 'runner_badge']
  },
  '10': {
    distanceKm: 10,
    amountPaise: 120000,
    inclusions: ['medal', 'runner_badge', 'refreshment_pack']
  },
  '20': {
    distanceKm: 20,
    amountPaise: 150000,
    inclusions: ['medal', 'runner_badge', 'event_tshirt']
  }
};
