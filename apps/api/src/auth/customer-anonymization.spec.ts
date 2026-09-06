import { anonymizedCustomerEmail } from './customer-anonymization';

describe('anonymizedCustomerEmail (US-020 T1.1)', () => {
  it('devuelve un email distinto para 2 customerId distintos', () => {
    const a = anonymizedCustomerEmail('11111111-1111-1111-1111-111111111111');
    const b = anonymizedCustomerEmail('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('usa el TLD .invalid (RFC 2606)', () => {
    expect(anonymizedCustomerEmail('11111111-1111-1111-1111-111111111111')).toMatch(
      /@anonimizado\.dsm\.invalid$/,
    );
  });
});
