import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CONSENT_COPY } from '@/features/legal/routes';
import { ConsentCheckbox } from './ConsentCheckbox';

describe('ConsentCheckbox — consume el seam de US-017 (D9)', () => {
  it('no marcado + error visible → aria-describedby apunta al mensaje', () => {
    render(
      <ConsentCheckbox
        checked={false}
        onChange={() => {}}
        error="Tenés que aceptar los términos para continuar."
        inputId="consent"
      />,
    );

    const checkbox = screen.getByRole('checkbox');
    const describedBy = checkbox.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/aceptar los términos/i);
  });

  it('marcado no bloquea: sin error visible', () => {
    render(<ConsentCheckbox checked onChange={() => {}} inputId="consent" />);

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('los dos enlaces usan el href de CONSENT_COPY.links, no un literal reconstruido', () => {
    render(<ConsentCheckbox checked={false} onChange={() => {}} inputId="consent" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(CONSENT_COPY.links.length);
    CONSENT_COPY.links.forEach((expected, i) => {
      expect(links[i]).toHaveAttribute('href', expected.href);
      expect(links[i]).toHaveTextContent(expected.label);
    });
  });

  it('toggling llama a onChange con el nuevo valor', async () => {
    const onChange = vi.fn();
    render(<ConsentCheckbox checked={false} onChange={onChange} inputId="consent" />);

    await userEvent.click(screen.getByRole('checkbox'));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
