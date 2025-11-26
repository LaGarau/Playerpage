import LoginForm from "../../components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <div className="flex items-center justify-center pt-8 pb-4 gap-4">
        
        <img className="w-[200px] justify-center items-center" src="/images/Transparent Ghumante Logo.png" alt="Logo" />
      </div>
      <div className="auth-inner">
        <LoginForm />
      </div>
    </div>
  );
}