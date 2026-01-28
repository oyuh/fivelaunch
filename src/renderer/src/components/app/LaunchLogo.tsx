import appLogo from '@resources/Logo.png'

export function LaunchLogo(): JSX.Element {
  return (
    <div
      className="h-16 w-16"
      aria-hidden="true"
      style={{
        backgroundColor: 'hsl(var(--primary))',
        WebkitMaskImage: `url(${appLogo})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskImage: `url(${appLogo})`,
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
        maskPosition: 'center'
      }}
    />
  )
}
