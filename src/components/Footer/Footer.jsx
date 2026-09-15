function Footer() {
  return (
    <footer className="breeze-app-footer mt-auto">
      <p>© {new Date().getFullYear()} All rights reserved.</p>
      <div className="breeze-app-footer__brand">
        <img src="/images/primary-logo.svg" alt="" />
        <span>ZATCA Compliance Hub v2.4.2</span>
      </div>
    </footer>
  );
}

export default Footer;
