from __future__ import annotations

import os

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QApplication,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
)

from opus_copy.cloud_client import CloudError, MistcutCloudClient


class LoginDialog(QDialog):
    def __init__(self, client: MistcutCloudClient, parent=None) -> None:
        super().__init__(parent)
        self.client = client
        self.setWindowTitle("Entrar no MISTCUT")
        self.setMinimumWidth(430)
        self.setModal(True)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 26, 28, 26)
        layout.setSpacing(12)

        brand = QLabel("MISTCUT")
        brand.setStyleSheet("font-size:26px;font-weight:800;letter-spacing:1.6px;")
        layout.addWidget(brand)

        title = QLabel("Entre para usar seus créditos")
        title.setStyleSheet("font-size:18px;font-weight:650;")
        layout.addWidget(title)

        subtitle = QLabel(
            "Sua conta, plano e créditos ficam sincronizados com o aplicativo."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color:#8D97A2;")
        layout.addWidget(subtitle)

        self.email = QLineEdit()
        self.email.setPlaceholderText("E-mail")
        self.email.setMinimumHeight(42)
        layout.addWidget(self.email)

        self.password = QLineEdit()
        self.password.setPlaceholderText("Senha")
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.setMinimumHeight(42)
        self.password.returnPressed.connect(self.try_login)
        layout.addWidget(self.password)

        self.error = QLabel("")
        self.error.setWordWrap(True)
        self.error.setStyleSheet("color:#ff7b72;")
        self.error.hide()
        layout.addWidget(self.error)

        self.login_button = QPushButton("ENTRAR  ›")
        self.login_button.setObjectName("primary")
        self.login_button.setMinimumHeight(44)
        self.login_button.clicked.connect(self.try_login)
        layout.addWidget(self.login_button)

        actions = QHBoxLayout()
        create = QPushButton("CRIAR CONTA")
        create.clicked.connect(self.open_register)
        actions.addWidget(create)
        actions.addStretch(1)
        layout.addLayout(actions)

    def open_register(self) -> None:
        web_url = os.getenv("MISTCUT_WEB_URL", "http://localhost:3000").rstrip("/")
        QDesktopServices.openUrl(QUrl(web_url + "/register"))

    def try_login(self) -> None:
        email = self.email.text().strip()
        password = self.password.text()
        if not email or not password:
            self.show_error("Informe seu e-mail e sua senha.")
            return

        self.login_button.setEnabled(False)
        self.login_button.setText("CONECTANDO…")
        self.error.hide()
        QApplication.processEvents()

        try:
            self.client.login(email, password)
            self.accept()
        except CloudError as exc:
            self.show_error(str(exc))
        finally:
            self.login_button.setEnabled(True)
            self.login_button.setText("ENTRAR  ›")

    def show_error(self, message: str) -> None:
        self.error.setText(message)
        self.error.show()


def ensure_login(client: MistcutCloudClient) -> bool:
    if client.restore_session():
        try:
            client.reconcile_pending()
        except CloudError:
            pass
        return True

    dialog = LoginDialog(client)
    if dialog.exec() != QDialog.DialogCode.Accepted:
        return False

    try:
        client.reconcile_pending()
    except CloudError:
        pass
    return True
